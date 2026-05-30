export interface AdminJwtPayload {
  sub: number;
  username: string;
  type: 'access' | 'refresh';
  jti?: string;
}

export interface AdminUser {
  id: number;
  username: string;
  fullName: string | null;
}

export interface LoginInput {
  username: string;
  password: string;
}
