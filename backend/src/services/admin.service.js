/**
 * Admin service — authentication and CRUD to be fully implemented later.
 */

export async function login({ username, password }) {
  // TODO: verify credentials against admins table (bcrypt)
  return {
    token: 'placeholder-jwt-token',
    user: { username: username || 'admin', role: 'admin' },
    message: 'Login skeleton — authentication not implemented yet',
  };
}

export async function getAdminLightPoints() {
  return {
    items: [],
    total: 0,
    message: 'Admin light points list — placeholder',
  };
}

export async function createLightPoint(body) {
  return {
    id: null,
    ...body,
    message: 'Create light point — placeholder',
  };
}

export async function updateLightPoint(id, body) {
  return {
    id: Number(id),
    ...body,
    message: 'Update light point — placeholder',
  };
}

export async function deleteLightPoint(id) {
  return { id: Number(id), deleted: true };
}
