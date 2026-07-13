// Command genkeys generates an RS256 key pair for JWT signing and writes the
// PEM files to the paths given by JWT_PRIVATE_KEY_PATH / JWT_PUBLIC_KEY_PATH
// (falling back to ./secrets). Run once per environment; the private key is
// git-ignored and must never be committed.
package main

import (
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/pem"
	"fmt"
	"os"
	"path/filepath"
)

const rsaBits = 2048

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "genkeys:", err)
		os.Exit(1)
	}
}

func run() error {
	privPath := envOr("JWT_PRIVATE_KEY_PATH", "./secrets/jwt_private.pem")
	pubPath := envOr("JWT_PUBLIC_KEY_PATH", "./secrets/jwt_public.pem")

	if err := os.MkdirAll(filepath.Dir(privPath), 0o700); err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(pubPath), 0o700); err != nil {
		return err
	}

	key, err := rsa.GenerateKey(rand.Reader, rsaBits)
	if err != nil {
		return err
	}

	privPEM := pem.EncodeToMemory(&pem.Block{
		Type:  "RSA PRIVATE KEY",
		Bytes: x509.MarshalPKCS1PrivateKey(key),
	})
	pubBytes, err := x509.MarshalPKIXPublicKey(&key.PublicKey)
	if err != nil {
		return err
	}
	pubPEM := pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: pubBytes})

	// Private key readable only by owner.
	if err := os.WriteFile(privPath, privPEM, 0o600); err != nil {
		return err
	}
	if err := os.WriteFile(pubPath, pubPEM, 0o644); err != nil {
		return err
	}

	fmt.Printf("wrote %s and %s\n", privPath, pubPath)
	return nil
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
