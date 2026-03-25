package orchestrator

import "testing"

func TestIsObjectiveComplete_Legacy(t *testing.T) {
	tests := []struct {
		name    string
		content string
		want    bool
	}{
		{"exact match", "OBJECTIVE_COMPLETE", true},
		{"with whitespace", "  OBJECTIVE_COMPLETE  ", true},
		{"embedded in text", "Based on my analysis, OBJECTIVE_COMPLETE is reached.", true},
		{"not complete", "I found some results but need to continue.", false},
		{"empty", "", false},
		{"partial", "OBJECTIVE_COMP", false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := isObjectiveComplete(tt.content); got != tt.want {
				t.Errorf("isObjectiveComplete(%q) = %v, want %v", tt.content, got, tt.want)
			}
		})
	}
}

func TestIsObjectiveComplete_StructuredJSON(t *testing.T) {
	tests := []struct {
		name    string
		content string
		want    bool
	}{
		{
			"json in code fence",
			"Here are my findings.\n```json\n{\"status\": \"complete\", \"summary\": \"All targets scanned\"}\n```\nDone.",
			true,
		},
		{
			"json in plain code fence",
			"Done.\n```\n{\"status\": \"complete\", \"summary\": \"Finished\"}\n```",
			true,
		},
		{
			"raw json inline",
			"I believe we are done. {\"status\": \"complete\", \"summary\": \"3 vulns found\"} That's all.",
			true,
		},
		{
			"status continue",
			"Still working.\n```json\n{\"status\": \"continue\", \"next_action\": \"scan port 8080\"}\n```",
			false,
		},
		{
			"no signal",
			"I found 3 open ports. Moving to the next phase of testing.",
			false,
		},
		{
			"json without status field",
			"```json\n{\"result\": \"complete\"}\n```",
			false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := isObjectiveComplete(tt.content); got != tt.want {
				t.Errorf("isObjectiveComplete() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestExtractCompletionSummary(t *testing.T) {
	tests := []struct {
		name    string
		content string
		want    string
	}{
		{
			"has summary",
			"```json\n{\"status\": \"complete\", \"summary\": \"Found 5 critical vulnerabilities\"}\n```",
			"Found 5 critical vulnerabilities",
		},
		{
			"no signal",
			"Still working on scanning.",
			"",
		},
		{
			"raw json",
			"All done. {\"status\": \"complete\", \"summary\": \"Report generated\"}",
			"Report generated",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := extractCompletionSummary(tt.content); got != tt.want {
				t.Errorf("extractCompletionSummary() = %q, want %q", got, tt.want)
			}
		})
	}
}
