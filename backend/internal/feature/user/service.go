package user

import (
	"context"

	"github.com/anush-capitals/lms-backend/internal/audit"
	"github.com/anush-capitals/lms-backend/internal/crypto"
	"github.com/anush-capitals/lms-backend/internal/domain"
)

// Service holds managed-user business logic: validation, password hashing, and
// the RBAC safety guards (never strand the system without an admin; an admin
// can't lock themselves out).
type Service struct {
	repo   *Repository
	hasher *crypto.Hasher
	// audits records who changed whose access: role, permissions, active,
	// password resets, two-factor resets, deletions.
	audits *audit.Recorder
}

func NewService(repo *Repository, hasher *crypto.Hasher, audits *audit.Recorder) *Service {
	return &Service{repo: repo, hasher: hasher, audits: audits}
}

// userSnapshot is the access-relevant view of a user kept in the audit trail.
func userSnapshot(u *domain.User) map[string]any {
	return map[string]any{
		"email": u.Email, "full_name": u.FullName, "role": string(u.Role),
		"permissions": u.Permissions, "is_active": u.IsActive, "two_factor": u.MFAEnabled,
	}
}

func (s *Service) record(ctx context.Context, id int64, action audit.Action, before, after any) {
	s.audits.Record(ctx, audit.Entry{EntityType: audit.EntityUser, EntityID: id, Action: action, Before: before, After: after})
}

func (s *Service) List(ctx context.Context) ([]*domain.User, error) { return s.repo.List(ctx) }

func (s *Service) Get(ctx context.Context, id int64) (*domain.User, error) {
	return s.repo.FindByID(ctx, id)
}

// AgentLoans maps each recovery agent to their assigned loans.
func (s *Service) AgentLoans(ctx context.Context) (map[int64][]int64, error) {
	return s.repo.AgentLoans(ctx)
}

// Create validates and persists a new user with a bcrypt-hashed password.
// actingUserID is recorded as the assigner of an agent's loans.
func (s *Service) Create(ctx context.Context, actingUserID int64, in domain.UserInput) (*domain.User, error) {
	if err := in.Validate(true); err != nil {
		return nil, err
	}
	hash, err := s.hasher.Hash(in.Password)
	if err != nil {
		return nil, err
	}
	u, err := s.repo.Create(ctx, in, hash, &actingUserID)
	if err != nil {
		return nil, err
	}
	s.record(ctx, u.ID, audit.ActionCreate, nil, userSnapshot(u))
	return u, nil
}

// Update edits a user. actingUserID is the authenticated admin making the
// change, used to block self-lockout. Password blank = unchanged. Demoting or
// disabling the last remaining admin is refused.
func (s *Service) Update(ctx context.Context, id, actingUserID int64, in domain.UserInput) (*domain.User, error) {
	existing, err := s.repo.FindByID(ctx, id)
	if err != nil {
		return nil, err
	}
	if err := in.Validate(false); err != nil {
		return nil, err
	}
	// A borrower's login can never become staff (or the reverse): that would
	// hand a customer the LMS, or bind a staff account to one borrower.
	if domain.IsStaffRole(existing.Role) != domain.IsStaffRole(in.Role) {
		return nil, domain.NewConflict("A customer portal login cannot be changed into a staff account (or the reverse). Create a new user instead.")
	}

	// Would this change strip the last active admin? (demoting from ADMIN, or
	// deactivating an ADMIN). Guard against it.
	losingAdmin := existing.Role == domain.RoleAdmin && (in.Role != domain.RoleAdmin || !in.IsActive)
	if losingAdmin {
		others, err := s.repo.CountOtherActiveAdmins(ctx, id)
		if err != nil {
			return nil, err
		}
		if others == 0 {
			return nil, domain.NewConflict("Cannot remove the last active admin")
		}
	}
	// An admin cannot demote or disable their own account (avoids self-lockout).
	if id == actingUserID && (in.Role != domain.RoleAdmin || !in.IsActive) {
		return nil, domain.NewConflict("You cannot change your own role or disable yourself")
	}
	// Your OWN password changes only through POST /me/password, which proves the
	// current one first — an unattended admin session must not be enough to
	// change the admin's password. (Other users' passwords: unchanged.)
	if id == actingUserID && in.Password != "" {
		return nil, domain.NewConflict("Change your own password under Settings → Change password — it asks for your current password.")
	}

	var hash string
	if in.Password != "" {
		h, err := s.hasher.Hash(in.Password)
		if err != nil {
			return nil, err
		}
		hash = h
	}
	u, err := s.repo.Update(ctx, id, in, hash, &actingUserID)
	if err != nil {
		return nil, err
	}
	after := userSnapshot(u)
	if hash != "" {
		after["password"] = "reset by admin"
	}
	s.record(ctx, id, audit.ActionUpdate, userSnapshot(existing), after)
	return u, nil
}

// OpenPasswordResetRequests lists "Forgot password?" requests awaiting an admin.
func (s *Service) OpenPasswordResetRequests(ctx context.Context) ([]*domain.PasswordResetRequest, error) {
	return s.repo.OpenPasswordResetRequests(ctx)
}

// DismissPasswordResetRequest closes a request without resetting the password.
func (s *Service) DismissPasswordResetRequest(ctx context.Context, id, actingUserID int64) error {
	if err := s.repo.DismissPasswordResetRequest(ctx, id, &actingUserID); err != nil {
		return err
	}
	s.audits.Record(ctx, audit.Entry{EntityType: audit.EntityPasswordResetRequest, EntityID: id,
		Action: audit.ActionUpdate, After: map[string]any{"status": "dismissed"}})
	return nil
}

// ResetMFA turns another user's two-factor off (lost phone). An admin's own
// two-factor is turned off from Settings with a current code instead, so a
// stolen admin session alone cannot remove it.
func (s *Service) ResetMFA(ctx context.Context, id, actingUserID int64) error {
	if id == actingUserID {
		return domain.NewConflict("Turn off your own two-factor under Settings → Two-factor authentication — it asks for a current code.")
	}
	if err := s.repo.ResetMFA(ctx, id); err != nil {
		return err
	}
	s.record(ctx, id, audit.ActionUpdate, nil, map[string]any{"two_factor": "reset by admin"})
	return nil
}

// SetActive enables/disables a user, with the same last-admin + self guards.
func (s *Service) SetActive(ctx context.Context, id, actingUserID int64, active bool) (*domain.User, error) {
	existing, err := s.repo.FindByID(ctx, id)
	if err != nil {
		return nil, err
	}
	if !active {
		if id == actingUserID {
			return nil, domain.NewConflict("You cannot disable your own account")
		}
		if existing.Role == domain.RoleAdmin {
			others, err := s.repo.CountOtherActiveAdmins(ctx, id)
			if err != nil {
				return nil, err
			}
			if others == 0 {
				return nil, domain.NewConflict("Cannot disable the last active admin")
			}
		}
	}
	u, err := s.repo.SetActive(ctx, id, active)
	if err != nil {
		return nil, err
	}
	s.record(ctx, id, audit.ActionUpdate, map[string]any{"is_active": existing.IsActive}, map[string]any{"is_active": active})
	return u, nil
}

// Delete soft-deletes a user, refusing to remove yourself or the last admin.
func (s *Service) Delete(ctx context.Context, id, actingUserID int64) error {
	if id == actingUserID {
		return domain.NewConflict("You cannot delete your own account")
	}
	existing, err := s.repo.FindByID(ctx, id)
	if err != nil {
		return err
	}
	if existing.Role == domain.RoleAdmin {
		others, err := s.repo.CountOtherActiveAdmins(ctx, id)
		if err != nil {
			return err
		}
		if others == 0 {
			return domain.NewConflict("Cannot delete the last active admin")
		}
	}
	if err := s.repo.SoftDelete(ctx, id); err != nil {
		return err
	}
	s.record(ctx, id, audit.ActionDelete, userSnapshot(existing), nil)
	return nil
}

// PortalLogin returns a customer's portal login, or NotFound when none exists.
func (s *Service) PortalLogin(ctx context.Context, customerID int64) (*PortalLogin, error) {
	return s.repo.FindPortalLogin(ctx, customerID)
}

// CreatePortalLogin gives a customer a bcrypt-hashed portal login. One live
// login per customer and one account per email are enforced by the database.
func (s *Service) CreatePortalLogin(ctx context.Context, customerID int64, in domain.PortalLoginInput) (*PortalLogin, error) {
	if err := in.Validate(); err != nil {
		return nil, err
	}
	hash, err := s.hasher.Hash(in.Password)
	if err != nil {
		return nil, err
	}
	p, err := s.repo.CreatePortalLogin(ctx, customerID, in.Email, hash)
	if err != nil {
		return nil, err
	}
	s.audits.Record(ctx, audit.Entry{EntityType: audit.EntityCustomer, EntityID: customerID, Action: audit.ActionUpdate,
		After: map[string]any{"portal_login": "created", "email": p.Email}})
	return p, nil
}
