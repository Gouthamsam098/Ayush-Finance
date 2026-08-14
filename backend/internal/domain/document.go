package domain

import (
	"strings"
	"time"
)

// DocumentType is the kind of KYC document. Kept deliberately small; the DB
// enforces the same set.
type DocumentType string

const (
	DocAadhaar  DocumentType = "AADHAAR"
	DocPAN      DocumentType = "PAN"
	DocLicense  DocumentType = "LICENSE"  // vehicle loans
	DocRC       DocumentType = "RC"       // vehicle loans (registration certificate)
	DocProperty DocumentType = "PROPERTY" // property loans
	DocPhoto    DocumentType = "PHOTO"    // borrower photo (optional)
	DocOther    DocumentType = "OTHER"    // any additional supporting document (optional)
)

// MaxDocumentBytes caps a single upload. Named constant, not a magic number;
// KYC scans comfortably fit under 5 MiB.
const MaxDocumentBytes = 5 << 20 // 5 MiB

var validDocTypes = map[DocumentType]bool{
	DocAadhaar: true, DocPAN: true, DocLicense: true, DocRC: true, DocProperty: true,
	DocPhoto: true, DocOther: true,
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

// DetectDocumentMIME identifies a file from its BYTES, ignoring whatever the
// client claimed in the multipart header.
//
// The declared Content-Type is attacker-controlled, so allow-listing it alone
// let an executable, HTML or SVG payload be stored as "image/png" and later
// served back with that type. Sniffing the magic bytes and requiring the two to
// agree closes the confusion: a file is accepted only if what it *is* is on the
// allow-list.
//
// Returns the detected type, or "" when the content matches none of the four
// accepted formats.
func DetectDocumentMIME(content []byte) string {
	switch {
	case len(content) >= 3 && content[0] == 0xFF && content[1] == 0xD8 && content[2] == 0xFF:
		return "image/jpeg"
	case len(content) >= 8 && string(content[:8]) == "\x89PNG\r\n\x1a\n":
		return "image/png"
	case len(content) >= 12 && string(content[:4]) == "RIFF" && string(content[8:12]) == "WEBP":
		return "image/webp"
	case len(content) >= 5 && string(content[:5]) == "%PDF-":
		return "application/pdf"
	}
	return ""
}

// DocumentContentMatchesDeclared reports whether the real content type is
// acceptable and consistent with what the client declared. Both must be on the
// allow-list, and image/jpeg content may not be uploaded as application/pdf.
func DocumentContentMatchesDeclared(content []byte, declared string) (detected string, ok bool) {
	detected = DetectDocumentMIME(content)
	if detected == "" || !IsAllowedDocumentMIME(detected) {
		return detected, false
	}
	// The declared type must match the sniffed one. Anything else is either a
	// mistake or an attempt at content confusion.
	return detected, detected == declared
}

// maxFileNameLen bounds the stored name; long names bloat responses and can
// break clients that write them to disk.
const maxFileNameLen = 120

// SanitizeFileName makes a client-supplied upload filename safe to store and to
// echo back in a Content-Disposition header.
//
// The name arrives from the multipart header, i.e. fully attacker-controlled. It
// is stripped of:
//   - any directory component (path traversal: "../../etc/passwd" → "passwd");
//   - quotes, CR and LF, which would otherwise break out of the quoted
//     filename parameter and inject header content;
//   - other control characters.
//
// An empty or fully-stripped name falls back to "document" so the header is
// always well-formed.
func SanitizeFileName(name string) string {
	// Drop any path prefix, handling both separators (a Windows client sends \).
	if i := strings.LastIndexAny(name, `/\`); i >= 0 {
		name = name[i+1:]
	}
	var b strings.Builder
	for _, r := range name {
		switch {
		case r == '"' || r == '\\' || r == '\r' || r == '\n':
			// header-breaking characters — drop
		case r < 0x20 || r == 0x7f:
			// other control characters — drop
		default:
			b.WriteRune(r)
		}
	}
	out := strings.TrimSpace(b.String())
	// A name of only dots ("." / "..") is not a usable filename.
	if strings.Trim(out, ".") == "" {
		return "document"
	}
	if len(out) > maxFileNameLen {
		out = out[:maxFileNameLen]
	}
	return out
}

// Document is a stored KYC file. Content holds the raw bytes; it is loaded only
// when the file is downloaded, never when listing metadata.
type Document struct {
	ID         int64
	CustomerID int64
	Type       DocumentType
	FileName   string
	MimeType   string
	SizeBytes  int64
	Content    []byte
	CreatedAt  time.Time
}
