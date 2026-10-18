/**
 * Window events that tell the data layer something changed on the server
 * outside the normal DataContext write paths.
 */

/** Collections were recorded server-side (e.g. a portal payment proof was
 *  accepted). DataContext refetches loans + collections so the Dashboard,
 *  Collections, Reports and the customer portal reflect the new money. */
export const COLLECTIONS_CHANGED_EVENT = 'anush:collections-changed';
