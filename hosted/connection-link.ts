/** Resolve an omitted connection only when the approved choices are unambiguous. */
export function resolveLinkConnection<T extends { readonly id: string }>(id: string | undefined, available: readonly T[]): T {
  if (id !== undefined) {
    const connection = available.find(connection => connection.id === id);
    if (!connection) throw new Error('The linked connection is not approved on this device. Open extension connection settings or choose another connection.');
    return connection;
  }
  if (!available.length) throw new Error('No approved signed-in connection is available for this link. Open extension connection settings.');
  if (available.length !== 1) throw new Error('This link needs a connection ID because more than one approved connection is available. Choose a connection explicitly.');
  return available[0];
}
