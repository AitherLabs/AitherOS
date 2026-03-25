package engine

import (
	"fmt"
	"regexp"
	"strings"

	"github.com/aitheros/backend/internal/models"
)

var templateVarRegex = regexp.MustCompile(`\{\{(\w+)\}\}`)

// InterpolatePrompt replaces {{variable_name}} placeholders in a prompt string
// with the corresponding values from the inputs map.
// Missing required variables cause an error; missing optional ones use defaults.
func InterpolatePrompt(template string, variables []models.AgentVariable, inputs map[string]string) (string, error) {
	// Build lookup: variable name → AgentVariable
	varDefs := make(map[string]models.AgentVariable, len(variables))
	for _, v := range variables {
		varDefs[v.Name] = v
	}

	// Check all required variables are present
	for _, v := range variables {
		if v.Required {
			val, ok := inputs[v.Name]
			if !ok || strings.TrimSpace(val) == "" {
				if v.Default != "" {
					inputs[v.Name] = v.Default
				} else {
					return "", fmt.Errorf("required variable %q is missing", v.Name)
				}
			}
		}
	}

	// Replace all {{var}} occurrences
	result := templateVarRegex.ReplaceAllStringFunc(template, func(match string) string {
		varName := templateVarRegex.FindStringSubmatch(match)[1]
		if val, ok := inputs[varName]; ok {
			return val
		}
		// If defined with a default, use it
		if def, ok := varDefs[varName]; ok && def.Default != "" {
			return def.Default
		}
		// Leave placeholder as-is if not defined (might be a non-variable template)
		return match
	})

	return result, nil
}

// ExtractVariableNames returns all {{variable}} names found in a template string.
func ExtractVariableNames(template string) []string {
	matches := templateVarRegex.FindAllStringSubmatch(template, -1)
	seen := make(map[string]bool)
	var names []string
	for _, m := range matches {
		name := m[1]
		if !seen[name] {
			seen[name] = true
			names = append(names, name)
		}
	}
	return names
}
