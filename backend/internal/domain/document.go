package domain

import "time"

// DocumentType is the kind of KYC document. Kept deliberately small; the DB
// enforces the same set.
type DocumentType string

const (
	DocAadhaar  DocumentType = "AADHAAR"
	DocPAN      DocumentType = "PAN"
	DocLicense  DocumentType = "LICENSE"  // vehicle loans
	DocRC       DocumentType = "RC"       // vehicle loans (registration certificate)
	DocProperty DocumentType = "PROPERTY" // property loans
)

// MaxDocumentBytes caps a single upload. Named constant, not a magic number;
// KYC scans comfortably fit under 5 MiB.
const MaxDocumentBytes = 5 << 20 // 5 MiB

var validDocTypes = map[DocumentType]bool{
	DocAadhaar: true, DocPAN: true, DocLicense: true, DocRC: true, DocProperty: true,
}

// IsValidDocumentType reports whether t is an accepted document type.
func IsValidDocumentType(t DocumentType) bool { return validDocTypes[t] }

// allowedDocMIME lists the content types we accept for KYC scans.
var allowedDocMIME = map[string]bool{
	"image/jpeg":      true,
	"image/png":       true,
	"image/webp":      true,
	"application/pdf": true,
}

// IsAllowedDocumentMIME reports whether the given content type may be uploaded.
func IsAllowedDocumentMIME(mime string) bool { return allowedDocMIME[mime] }

// Document is a stored KYC file. Content holds the raw bytes; it is loaded only
// when the file is downloaded, never when listing metadata.
type Document struct {
	ID         string
	CustomerID string
	Type       DocumentType
	FileName   string
	MimeType   string
	SizeBytes  int64
	Content    []byte
	CreatedAt  time.Time
}
