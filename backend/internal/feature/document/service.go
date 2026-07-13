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
	CustomerID string
	Type       domain.DocumentType
	FileName   string
	MimeType   string
	Content    []byte
	UploadedBy string
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

func (s *Service) List(ctx context.Context, customerID string) ([]*domain.Document, error) {
	return s.repo.ListByCustomer(ctx, customerID)
}

func (s *Service) Download(ctx context.Context, id string) (*domain.Document, error) {
	return s.repo.Download(ctx, id)
}

func (s *Service) Delete(ctx context.Context, id string) error {
	return s.repo.SoftDelete(ctx, id)
}
