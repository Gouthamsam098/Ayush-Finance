package document

import (
	"context"

	"github.com/anush-capitals/lms-backend/internal/domain"
)

type Service struct {
	repo *Repository
}

func NewService(repo *Repository) *Service {
	return &Service{repo: repo}
}

// UploadInput is a validated upload request.
type UploadInput struct {
	CustomerID int64
	Type       domain.DocumentType
	FileName   string
	MimeType   string
	Content    []byte
	UploadedBy *int64
}

// Upload validates and stores a document. No verification/approval workflow is
// applied — the file is simply persisted against the customer.
func (s *Service) Upload(ctx context.Context, in UploadInput) (*domain.Document, error) {
	if !domain.IsValidDocumentType(in.Type) {
		return nil, domain.NewValidation("invalid document type", map[string]string{
			"type": "must be AADHAAR or PAN",
		})
	}
	if len(in.Content) == 0 {
		return nil, domain.NewValidation("file is empty", nil)
	}
	if int64(len(in.Content)) > domain.MaxDocumentBytes {
		return nil, domain.NewValidation("file exceeds the 5 MB limit", nil)
	}
	if !domain.IsAllowedDocumentMIME(in.MimeType) {
		return nil, domain.NewValidation("unsupported file type", map[string]string{
			"file": "allowed types: JPEG, PNG, WebP, PDF",
		})
	}
	// The declared Content-Type came from the client's multipart header and is
	// therefore untrusted. Sniff the real bytes and require agreement, so a
	// script/HTML payload cannot be stored as an image and served back with an
	// image type (content confusion / stored XSS on preview).
	detected, ok := domain.DocumentContentMatchesDeclared(in.Content, in.MimeType)
	if !ok {
		if detected == "" {
			return nil, domain.NewValidation("unrecognised file content", map[string]string{
				"file": "the file is not a valid JPEG, PNG, WebP or PDF",
			})
		}
		return nil, domain.NewValidation("file content does not match its type", map[string]string{
			"file": "the file's actual format (" + detected + ") differs from the type sent",
		})
	}
	// Store the SNIFFED type — never the client's claim.
	in.MimeType = detected

	exists, err := s.repo.customerExists(ctx, in.CustomerID)
	if err != nil {
		return nil, err
	}
	if !exists {
		return nil, domain.NewNotFound("customer")
	}

	return s.repo.Create(ctx, &domain.Document{
		CustomerID: in.CustomerID,
		Type:       in.Type,
		FileName:   in.FileName,
		MimeType:   in.MimeType,
		SizeBytes:  int64(len(in.Content)),
		Content:    in.Content,
	}, in.UploadedBy)
}

func (s *Service) List(ctx context.Context, customerID int64) ([]*domain.Document, error) {
	return s.repo.ListByCustomer(ctx, customerID)
}

// Download returns a document's bytes only if it belongs to customerID. Both
// IDs come from the request path; the ownership check lives in the query so a
// mismatch is indistinguishable from "does not exist" (NotFound).
func (s *Service) Download(ctx context.Context, id, customerID int64) (*domain.Document, error) {
	return s.repo.Download(ctx, id, customerID)
}

// Delete soft-deletes a document only if it belongs to customerID.
func (s *Service) Delete(ctx context.Context, id, customerID int64) error {
	return s.repo.SoftDelete(ctx, id, customerID)
}
