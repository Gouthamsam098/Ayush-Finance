package document

import (
	"io"
	"net/http"
	"strconv"

	"github.com/anush-capitals/lms-backend/internal/domain"
	"github.com/anush-capitals/lms-backend/internal/httpx"
	"github.com/go-chi/chi/v5"
)

type Handler struct {
	service *Service
}

func NewHandler(service *Service) *Handler {
	return &Handler{service: service}
}

// Routes are mounted under /customers/{customerId}/documents by the router.
func (h *Handler) Routes() chi.Router {
	r := chi.NewRouter()
	r.Post("/", h.upload)
	r.Get("/", h.list)
	r.Get("/{docId}/download", h.download)
	r.Delete("/{docId}", h.delete)
	return r
}

type documentResponse struct {
	ID        int64  `json:"id"`
	Type      string `json:"type"`
	FileName  string `json:"file_name"`
	MimeType  string `json:"mime_type"`
	SizeBytes int64  `json:"size_bytes"`
	CreatedAt string `json:"created_at"`
}

func toResponse(d *domain.Document) documentResponse {
	return documentResponse{
		ID: d.ID, Type: string(d.Type), FileName: d.FileName,
		MimeType: d.MimeType, SizeBytes: d.SizeBytes,
		CreatedAt: d.CreatedAt.Format("2006-01-02T15:04:05Z07:00"),
	}
}

func (h *Handler) upload(w http.ResponseWriter, r *http.Request) {
	customerID, err := strconv.ParseInt(chi.URLParam(r, "customerId"), 10, 64)
	if err != nil {
		httpx.Error(w, r, domain.NewNotFound("customer"))
		return
	}

	// Cap the request body before parsing so an oversized upload cannot exhaust
	// memory. +1 MiB slack over the file limit covers multipart overhead.
	r.Body = http.MaxBytesReader(w, r.Body, domain.MaxDocumentBytes+(1<<20))
	if err := r.ParseMultipartForm(domain.MaxDocumentBytes + (1 << 20)); err != nil {
		httpx.Error(w, r, domain.NewValidation("file exceeds the 5 MB limit or form is malformed", nil))
		return
	}

	docType := domain.DocumentType(r.FormValue("type"))

	file, header, err := r.FormFile("file")
	if err != nil {
		httpx.Error(w, r, domain.NewValidation("a file is required under the 'file' field", nil))
		return
	}
	defer file.Close()

	content, err := io.ReadAll(file)
	if err != nil {
		httpx.Error(w, r, domain.NewValidation("could not read the uploaded file", nil))
		return
	}

	var uploadedBy *int64
	if uid, err := strconv.ParseInt(httpx.UserID(r.Context()), 10, 64); err == nil {
		uploadedBy = &uid
	}

	doc, err := h.service.Upload(r.Context(), UploadInput{
		CustomerID: customerID,
		Type:       docType,
		// Sanitised at the boundary so the stored value is already safe (strips
		// path components, quotes and control characters from the client-supplied
		// multipart filename). Download re-sanitises defensively.
		FileName:   domain.SanitizeFileName(header.Filename),
		MimeType:   header.Header.Get("Content-Type"),
		Content:    content,
		UploadedBy: uploadedBy,
	})
	if err != nil {
		httpx.Error(w, r, err)
		return
	}
	httpx.Created(w, toResponse(doc))
}

func (h *Handler) list(w http.ResponseWriter, r *http.Request) {
	customerID, err := strconv.ParseInt(chi.URLParam(r, "customerId"), 10, 64)
	if err != nil {
		httpx.Error(w, r, domain.NewNotFound("customer"))
		return
	}
	docs, err := h.service.List(r.Context(), customerID)
	if err != nil {
		httpx.Error(w, r, err)
		return
	}
	items := make([]documentResponse, 0, len(docs))
	for _, d := range docs {
		items = append(items, toResponse(d))
	}
	httpx.JSON(w, http.StatusOK, items)
}

func (h *Handler) download(w http.ResponseWriter, r *http.Request) {
	docID, err := strconv.ParseInt(chi.URLParam(r, "docId"), 10, 64)
	if err != nil {
		httpx.Error(w, r, domain.NewNotFound("document"))
		return
	}
	// The {customerId} path segment is part of the authorization decision, not
	// decoration: the document must belong to it or this is a NotFound.
	customerID, err := strconv.ParseInt(chi.URLParam(r, "customerId"), 10, 64)
	if err != nil {
		httpx.Error(w, r, domain.NewNotFound("customer"))
		return
	}
	doc, err := h.service.Download(r.Context(), docID, customerID)
	if err != nil {
		httpx.Error(w, r, err)
		return
	}
	w.Header().Set("Content-Type", doc.MimeType)
	w.Header().Set("Content-Length", strconv.FormatInt(doc.SizeBytes, 10))
	// The stored MIME type is what the browser is told, so forbid sniffing: a
	// file uploaded with a spoofed content type must not be re-interpreted as
	// HTML/script and executed in this origin.
	w.Header().Set("X-Content-Type-Options", "nosniff")
	// inline so the browser can preview images/PDFs; filename for downloads.
	// The filename is quoted via a sanitiser — it originates from the client's
	// multipart header, so a raw value containing a quote or CR/LF could break
	// out of the quoted parameter and inject header content.
	w.Header().Set("Content-Disposition", `inline; filename="`+domain.SanitizeFileName(doc.FileName)+`"`)
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(doc.Content)
}

func (h *Handler) delete(w http.ResponseWriter, r *http.Request) {
	docID, err := strconv.ParseInt(chi.URLParam(r, "docId"), 10, 64)
	if err != nil {
		httpx.Error(w, r, domain.NewNotFound("document"))
		return
	}
	// Ownership is enforced by the {customerId} scope (see download).
	customerID, err := strconv.ParseInt(chi.URLParam(r, "customerId"), 10, 64)
	if err != nil {
		httpx.Error(w, r, domain.NewNotFound("customer"))
		return
	}
	if err := h.service.Delete(r.Context(), docID, customerID); err != nil {
		httpx.Error(w, r, err)
		return
	}
	httpx.NoContent(w)
}
