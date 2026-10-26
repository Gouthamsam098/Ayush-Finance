package auth

import (
	"testing"
	"time"
)

func TestAccountLocksAfterRepeatedFailures(t *testing.T) {
	g := newAccountGuard()
	now := time.Date(2026, 10, 26, 10, 0, 0, 0, time.Local)
	for i := 1; i < accountMaxFailures; i++ {
		g.fail("Admin@Example.com ", now)
		if g.locked("admin@example.com", now) {
			t.Fatalf("locked after only %d failures", i)
		}
	}
	g.fail("admin@example.com", now)
	if !g.locked("ADMIN@example.com", now) {
		t.Fatal("must lock after the threshold (email case/space-insensitive)")
	}
	if !g.locked("admin@example.com", now.Add(accountLockout-time.Second)) {
		t.Error("lock must hold for the whole lockout period")
	}
	if g.locked("admin@example.com", now.Add(accountLockout)) {
		t.Error("lock must expire")
	}
	if g.locked("someone.else@example.com", now) {
		t.Error("a lock must not spill onto other accounts")
	}
}

func TestFailuresOutsideTheWindowDoNotAccumulate(t *testing.T) {
	g := newAccountGuard()
	now := time.Date(2026, 10, 26, 10, 0, 0, 0, time.Local)
	for i := 0; i < accountMaxFailures-1; i++ {
		g.fail("a@example.com", now)
	}
	later := now.Add(accountFailWindow + time.Minute)
	g.fail("a@example.com", later)
	if g.locked("a@example.com", later) {
		t.Error("old failures outside the window must not count")
	}
}

func TestSuccessClearsFailures(t *testing.T) {
	g := newAccountGuard()
	now := time.Date(2026, 10, 26, 10, 0, 0, 0, time.Local)
	for i := 0; i < accountMaxFailures-1; i++ {
		g.fail("a@example.com", now)
	}
	g.succeed("a@example.com")
	g.fail("a@example.com", now)
	if g.locked("a@example.com", now) {
		t.Error("a successful sign-in must reset the count")
	}
}
