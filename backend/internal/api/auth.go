package api

import (
	"net/http"

	"github.com/aitheros/backend/internal/auth"
	"github.com/aitheros/backend/internal/models"
	"github.com/aitheros/backend/internal/store"
	"github.com/google/uuid"
)

type AuthHandler struct {
	store             *store.Store
	jwt               *auth.JWTManager
	registrationToken string // if non-empty, self-registration requires this token
}

func NewAuthHandler(s *store.Store, jwt *auth.JWTManager, registrationToken string) *AuthHandler {
	return &AuthHandler{store: s, jwt: jwt, registrationToken: registrationToken}
}

// Register creates a new user account.
// POST /api/v1/auth/register
func (h *AuthHandler) Register(w http.ResponseWriter, r *http.Request) {
	var req models.RegisterRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body: "+err.Error())
		return
	}

	if h.registrationToken != "" && req.RegistrationToken != h.registrationToken {
		writeError(w, http.StatusForbidden, "invalid or missing registration token")
		return
	}

	if req.Email == "" {
		writeError(w, http.StatusBadRequest, "email is required")
		return
	}
	if req.Username == "" {
		writeError(w, http.StatusBadRequest, "username is required")
		return
	}
	if len(req.Password) < 8 {
		writeError(w, http.StatusBadRequest, "password must be at least 8 characters")
		return
	}

	user, err := h.store.CreateUser(r.Context(), req)
	if err != nil {
		writeError(w, http.StatusConflict, "registration failed: "+err.Error())
		return
	}

	token, err := h.jwt.GenerateToken(user.ID, user.Username, string(user.Role))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to generate token")
		return
	}

	writeJSON(w, http.StatusCreated, models.LoginResponse{
		Token: token,
		User:  user,
	})
}

// Login authenticates a user and returns a JWT.
// POST /api/v1/auth/login
func (h *AuthHandler) Login(w http.ResponseWriter, r *http.Request) {
	var req models.LoginRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body: "+err.Error())
		return
	}

	if req.Login == "" || req.Password == "" {
		writeError(w, http.StatusBadRequest, "login and password are required")
		return
	}

	user, err := h.store.Authenticate(r.Context(), req.Login, req.Password)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "invalid credentials")
		return
	}

	token, err := h.jwt.GenerateToken(user.ID, user.Username, string(user.Role))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to generate token")
		return
	}

	writeJSON(w, http.StatusOK, models.LoginResponse{
		Token: token,
		User:  user,
	})
}

// Me returns the currently authenticated user.
// GET /api/v1/auth/me
func (h *AuthHandler) Me(w http.ResponseWriter, r *http.Request) {
	claims := auth.GetClaims(r.Context())
	if claims == nil {
		writeError(w, http.StatusUnauthorized, "not authenticated")
		return
	}

	user, err := h.store.GetUser(r.Context(), claims.UserID)
	if err != nil {
		writeError(w, http.StatusNotFound, "user not found")
		return
	}

	writeJSON(w, http.StatusOK, user)
}

// UpdateMe updates the authenticated user's profile.
// PATCH /api/v1/auth/me
func (h *AuthHandler) UpdateMe(w http.ResponseWriter, r *http.Request) {
	claims := auth.GetClaims(r.Context())
	if claims == nil {
		writeError(w, http.StatusUnauthorized, "not authenticated")
		return
	}

	var req models.UpdateProfileRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body: "+err.Error())
		return
	}

	user, err := h.store.UpdateProfile(r.Context(), claims.UserID, req)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to update profile: "+err.Error())
		return
	}

	writeJSON(w, http.StatusOK, user)
}

// AdminListUsers returns all users. Admin-only.
// GET /api/v1/admin/users
func (h *AuthHandler) AdminListUsers(w http.ResponseWriter, r *http.Request) {
	users, err := h.store.ListUsers(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list users: "+err.Error())
		return
	}
	writeJSON(w, http.StatusOK, users)
}

// AdminCreateUser creates a user with an explicit role. Admin-only.
// POST /api/v1/admin/users
func (h *AuthHandler) AdminCreateUser(w http.ResponseWriter, r *http.Request) {
	var req models.AdminCreateUserRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body: "+err.Error())
		return
	}

	if req.Email == "" {
		writeError(w, http.StatusBadRequest, "email is required")
		return
	}
	if req.Username == "" {
		writeError(w, http.StatusBadRequest, "username is required")
		return
	}
	if len(req.Password) < 8 {
		writeError(w, http.StatusBadRequest, "password must be at least 8 characters")
		return
	}

	user, err := h.store.AdminCreateUser(r.Context(), req)
	if err != nil {
		writeError(w, http.StatusConflict, "failed to create user: "+err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, user)
}

// AdminSetUserActive enables or disables a user. Admin-only.
// PATCH /api/v1/admin/users/{id}/active
func (h *AuthHandler) AdminSetUserActive(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid user id")
		return
	}

	var body struct {
		Active bool `json:"active"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body: "+err.Error())
		return
	}

	if err := h.store.SetUserActive(r.Context(), id, body.Active); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to update user: "+err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"active": body.Active})
}
