package api

import (
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/google/uuid"
)

const (
	maxUploadSize = 10 << 20 // 10 MB
	uploadDir     = "/opt/AitherOS/uploads"
)

var allowedMIME = map[string]string{
	"image/jpeg":      ".jpg",
	"image/png":       ".png",
	"image/webp":      ".webp",
	"image/gif":       ".gif",
	"application/pdf": ".pdf",
	"text/plain":      ".txt",
	"text/csv":        ".csv",
	// SVG intentionally excluded: can contain inline JS (XSS vector)
}

type UploadHandler struct{}

func NewUploadHandler() *UploadHandler { return &UploadHandler{} }

// Upload handles multipart file uploads.
// POST /api/v1/upload  (field name: "file")
// Returns: { "url": "/uploads/<uuid>.<ext>" }
func (h *UploadHandler) Upload(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, maxUploadSize)
	if err := r.ParseMultipartForm(maxUploadSize); err != nil {
		writeError(w, http.StatusBadRequest, "file too large (max 10 MB)")
		return
	}

	file, header, err := r.FormFile("file")
	if err != nil {
		writeError(w, http.StatusBadRequest, "missing file field")
		return
	}
	defer file.Close()

	// Detect MIME from first 512 bytes
	buf := make([]byte, 512)
	n, _ := file.Read(buf)
	mimeType := http.DetectContentType(buf[:n])
	// Trim parameters (e.g. "text/plain; charset=utf-8" → "text/plain")
	if idx := strings.Index(mimeType, ";"); idx != -1 {
		mimeType = strings.TrimSpace(mimeType[:idx])
	}

	// Also trust explicit MIME from form if it's more specific (e.g. SVG)
	if ct := header.Header.Get("Content-Type"); ct != "" {
		if idx := strings.Index(ct, ";"); idx != -1 {
			ct = strings.TrimSpace(ct[:idx])
		}
		if _, ok := allowedMIME[ct]; ok {
			mimeType = ct
		}
	}

	ext, ok := allowedMIME[mimeType]
	if !ok {
		writeError(w, http.StatusBadRequest, fmt.Sprintf("unsupported file type: %s", mimeType))
		return
	}

	// Ensure upload directory exists
	if err := os.MkdirAll(uploadDir, 0755); err != nil {
		writeError(w, http.StatusInternalServerError, "upload directory unavailable")
		return
	}

	filename := uuid.New().String() + ext
	destPath := filepath.Join(uploadDir, filename)

	dest, err := os.Create(destPath)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to save file")
		return
	}
	defer dest.Close()

	// Rewind file: write the already-read bytes first, then copy the rest
	if _, err := dest.Write(buf[:n]); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to write file")
		return
	}
	if _, err := io.Copy(dest, file); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to write file")
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{
		"url":      "/uploads/" + filename,
		"filename": filename,
	})
}
