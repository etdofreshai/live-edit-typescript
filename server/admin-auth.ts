export type AdminAuthHeaders = {
  get(name: string): string | undefined;
};

export function isAdminAuthorized(headers: AdminAuthHeaders, configuredToken: string | undefined): boolean {
  if (!configuredToken) return true;

  const authorization = headers.get('authorization') || '';
  if (authorization === `Bearer ${configuredToken}`) return true;

  return headers.get('x-admin-token') === configuredToken;
}
