/**
 * Window events that tell the data layer something changed on the server
 * outside the normal DataContext write paths.
 */

/** Collections were recorded server-side (e.g. a portal payment proof was
 *  accepted). DataContext refetches loans + collections so the Dashboard,
 *  Collections, Reports and the customer portal reflect the new money. */
export const COLLECTIONS_CHANGED_EVENT = 'anush:collections-changed';

/** A "Forgot password?" request was resolved or dismissed in Settings, so the
 *  sidebar's request count should refresh now rather than on its next poll. */
export const PASSWORD_RESET_REQUESTS_CHANGED_EVENT = 'anush:password-reset-requests-changed';
