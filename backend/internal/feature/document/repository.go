// Package document implements customer KYC document storage: upload, list,
// download, and delete, across repository -> service -> handler layers. File
// bytes live in Postgres (bytea); listing never loads the content column.
package document

import (
	"context"
	"errors"

	"github.com/anush-capitals/lms-backend/internal/domain"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Repository struct {
	pool *pgxpool.Pool
}

func NewRepository(pool *pgxpool.Pool) *Repository {
	return &Repository{pool: pool}
}

// customerExists guards uploads/lists against a missing or deleted customer.
func (r *Repository) customerExists(ctx context.Context, customerID int64) (bool, error) {
	var exists bool
	err := r.pool.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM customers WHERE id = $1 AND deleted_at IS NULL)`,
		customerID).Scan(&exists)
	return exists, err
}

// Create stores a document's bytes and metadata, returning the metadata (no
// content) of the new row.
func (r *Repository) Create(ctx context.Context, d *domain.Document, uploadedBy *int64) (*domain.Document, error) {
	const query = `
		INSERT INTO documents (customer_id, type, file_name, mime_type, size_bytes, content, uploaded_by)
		VALUES ($1,$2,$3,$4,$5,$6,$7)
		RETURNING id, created_at`
	err := r.pool.QueryRow(ctx, query,
		d.CustomerID, d.Type, d.FileName, d.MimeType, d.SizeBytes, d.Content, uploadedBy,
	).Scan(&d.ID, &d.CreatedAt)
	if err != nil {
		return nil, err
	}
	d.Content = nil // caller returns metadata only
	return d, nil
}

// ListByCustomer returns document metadata (no content) for a customer.
func (r *Repository) ListByCustomer(ctx context.Context, customerID int64) ([]*domain.Document, error) {
	const query = `
		SELECT id, customer_id, type, file_name, mime_type, size_bytes, created_at
		FROM documents
		WHERE customer_id = $1 AND deleted_at IS NULL
		ORDER BY created_at DESC`
	rows, err := r.pool.Query(ctx, query, customerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var docs []*domain.Document
	for rows.Next() {
		var d domain.Document
		if err := rows.Scan(&d.ID, &d.CustomerID, &d.Type, &d.FileName,
			&d.MimeType, &d.SizeBytes, &d.CreatedAt); err != nil {
			return nil, err
		}
		docs = append(docs, &d)
	}
	return docs, rows.Err()
}

// Download loads a single document including its content bytes.
func (r *Repository) Download(ctx context.Context, id int64) (*domain.Document, error) {
	const query = `
		SELECT id, customer_id, type, file_name, mime_type, size_bytes, content, created_at
		FROM documents
		WHERE id = $1 AND deleted_at IS NULL`
	var d domain.Document
	err := r.pool.QueryRow(ctx, query, id).Scan(
		&d.ID, &d.CustomerID, &d.Type, &d.FileName, &d.MimeType,
		&d.SizeBytes, &d.Content, &d.CreatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, domain.NewNotFound("document")
	}
	if err != nil {
		return nil, err
	}
	return &d, nil
}

// SoftDelete marks a document deleted.
func (r *Repository) SoftDelete(ctx context.Context, id int64) error {
	tag, err := r.pool.Exec(ctx,
		`UPDATE documents SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL`, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return domain.NewNotFound("document")
	}
	return nil
}
