package user

import (
	"context"

	"github.com/anush-capitals/lms-backend/internal/crypto"
	"github.com/anush-capitals/lms-backend/internal/domain"
)

// Service holds managed-user business logic: validation, password hashing, and
// the RBAC safety guards (never strand the system without an admin; an admin
// can't lock themselves out).
type Service struct {
	repo   *Repository
	hasher *crypto.Hasher
}

func NewService(repo *Repository, hasher *crypto.Hasher) *Service {
	return &Service{repo: repo, hasher: hasher}
}

func (s *Service) List(ctx context.Context) ([]*domain.User, error) { return s.repo.List(ctx) }

func (s *Service) Get(ctx context.Context, id int64) (*domain.User, error) {
	return s.repo.FindByID(ctx, id)
}

// Create validates and persists a new user with a bcrypt-hashed password.
func (s *Service) Create(ctx context.Context, in domain.UserInput) (*domain.User, error) {
	if err := in.Validate(true); err != nil {
		return nil, err
	}
	hash, err := s.hasher.Hash(in.Password)
	if err != nil {
		return nil, err
	}
	return s.repo.Create(ctx, in, hash)
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

	var hash string
	if in.Password != "" {
		h, err := s.hasher.Hash(in.Password)
		if err != nil {
			return nil, err
		}
		hash = h
	}
	return s.repo.Update(ctx, id, in, hash)
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
	return s.repo.SetActive(ctx, id, active)
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
	return s.repo.SoftDelete(ctx, id)
}
