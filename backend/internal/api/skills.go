package api

import (
	"net/http"

	"github.com/aitheros/backend/internal/models"
	"github.com/aitheros/backend/internal/store"
	"github.com/google/uuid"
)

type SkillHandler struct {
	store *store.Store
}

func NewSkillHandler(s *store.Store) *SkillHandler {
	return &SkillHandler{store: s}
}

// List returns all skills in the library.
func (h *SkillHandler) List(w http.ResponseWriter, r *http.Request) {
	skills, err := h.store.ListSkills(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if skills == nil {
		skills = []models.Skill{}
	}
	writeJSON(w, http.StatusOK, skills)
}

// ListAgentSkills returns skills assigned to an agent.
func (h *SkillHandler) ListAgentSkills(w http.ResponseWriter, r *http.Request) {
	agentID, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid agent id")
		return
	}
	skills, err := h.store.GetAgentSkills(r.Context(), agentID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if skills == nil {
		skills = []models.Skill{}
	}
	writeJSON(w, http.StatusOK, skills)
}

// AssignSkill links a skill to an agent.
func (h *SkillHandler) AssignSkill(w http.ResponseWriter, r *http.Request) {
	agentID, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid agent id")
		return
	}
	var req models.AssignSkillRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body: "+err.Error())
		return
	}
	skillID, err := uuid.Parse(req.SkillID)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid skill_id")
		return
	}
	if err := h.store.AssignSkill(r.Context(), agentID, skillID, req.Position); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	skills, _ := h.store.GetAgentSkills(r.Context(), agentID)
	if skills == nil {
		skills = []models.Skill{}
	}
	writeJSON(w, http.StatusOK, skills)
}

// RemoveSkill unlinks a skill from an agent.
func (h *SkillHandler) RemoveSkill(w http.ResponseWriter, r *http.Request) {
	agentID, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid agent id")
		return
	}
	skillID, err := uuid.Parse(r.PathValue("skillID"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid skill id")
		return
	}
	if err := h.store.RemoveSkill(r.Context(), agentID, skillID); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	skills, _ := h.store.GetAgentSkills(r.Context(), agentID)
	if skills == nil {
		skills = []models.Skill{}
	}
	writeJSON(w, http.StatusOK, skills)
}
