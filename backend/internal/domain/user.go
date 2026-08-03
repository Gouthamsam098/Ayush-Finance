package domain

import (
	"regexp"
	"strings"
	"time"
)

// Role is a user's access level (RBAC). The DB enforces the same set
// (users_role_valid CHECK).
type Role string

const (
	RoleAdmin  Role = "ADMIN"  // full access + user management
	RoleViewer Role = "VIEWER" // uses the app; cannot manage users/settings
)

var validRoles = map[Role]bool{RoleAdmin: true, RoleViewer: true}

// IsValidRole reports whether r is an accepted role.
func IsValidRole(r Role) bool { return validRoles[r] }

// Modules are the app areas a VIEWER's access can be scoped to. Admins
// implicitly have edit on all; these govern what a Viewer sees/does.
var Modules = []string{"Dashboard", "Customers", "Loans", "Collections", "Expenses", "Documents", "Settings"}

// Access is a VIEWER's permission for a single module.
type Access string

const (
	AccessNone Access = "none"
	AccessView Access = "view"
	AccessEdit Access = "edit"
)

var validAccess = map[Access]bool{AccessNone: true, AccessView: true, AccessEdit: true}
var validModule = func() map[string]bool {
	m := make(map[string]bool, len(Modules))
	for _, x := range Modules {
		m[x] = true
	}
	return m
}()

// Permissions maps a module name to a VIEWER's access level. Missing module =
// no access. Ignored for admins (full edit everywhere).
type Permissions map[string]Access

// Normalize drops unknown modules / invalid values and defaults the rest to
// none, so what we store is always a clean, complete map.
func (p Permissions) Normalize() Permissions {
	out := make(Permissions, len(Modules))
	for _, m := range Modules {
		a := p[m]
		if !validAccess[a] {
			a = AccessNone
		}
		out[m] = a
	}
	return out
}

// AdminPermissions is the implicit full-edit map for admins.
func AdminPermissions() Permissions {
	out := make(Permissions, len(Modules))
	for _, m := range Modules {
		out[m] = AccessEdit
	}
	return out
}

// User is an operator account. PasswordHash is present in the struct because
// the service layer needs it to authenticate, but it must never be included
// in any API response — handlers map to a response DTO that omits it.
type User struct {
	ID           int64
	Email        string
	FullName     string
	PasswordHash string
	Role         Role
	Permissions  Permissions
	MFAEnabled   bool
	IsActive     bool
	LastLoginAt  *time.Time
	CreatedAt    time.Time
	UpdatedAt    time.Time
}

// IsAdmin is a convenience for RBAC checks.
func (u *User) IsAdmin() bool { return u.Role == RoleAdmin }

const (
	minUserPasswordLen = 8
	maxUserNameLen     = 255
)

var emailRe = regexp.MustCompile(`^[^@\s]+@[^@\s]+\.[^@\s]+$`)

// UserInput is the validated create/update payload for managed users. Password
// is required on create, optional on update (blank = keep existing).
type UserInput struct {
	Email       string
	FullName    string
	Password    string // plaintext; hashed by the service. Blank on update = unchanged.
	Role        Role
	Permissions Permissions // per-module access (VIEWER); ignored for ADMIN
	IsActive    bool
}

// EffectivePermissions returns what to store: admins get full edit; viewers get
// their normalized matrix.
func (in *UserInput) EffectivePermissions() Permissions {
	if in.Role == RoleAdmin {
		return AdminPermissions()
	}
	return in.Permissions.Normalize()
}

// Validate checks a managed-user payload. On create, a password is required; on
// update it may be blank (meaning "leave unchanged"), so pass requirePassword.
func (in *UserInput) Validate(requirePassword bool) error {
	fields := map[string]string{}

	email := strings.ToLower(strings.TrimSpace(in.Email))
	if email == "" {
		fields["email"] = "Email is required"
	} else if !emailRe.MatchString(email) {
		fields["email"] = "Enter a valid email address"
	}

	if strings.TrimSpace(in.FullName) == "" {
		fields["full_name"] = "Name is required"
	} else if len([]rune(strings.TrimSpace(in.FullName))) > maxUserNameLen {
		fields["full_name"] = "Name is too long"
	}

	if requirePassword || in.Password != "" {
		if len(in.Password) < minUserPasswordLen {
			fields["password"] = "Password must be at least 8 characters"
		}
	}

	if !IsValidRole(in.Role) {
		fields["role"] = "Select a valid role"
	}

	if len(fields) > 0 {
		return NewValidation("Please fix the highlighted fields", fields)
	}
	return nil
}
