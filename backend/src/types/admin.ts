export interface AdminLoginInput {
  username?: string;
  password?: string;
}

export interface AdminLoginResult {
  token: string;
  user: { username: string };
  message: string;
}

export interface AdminDeleteResult {
  id: number;
  deleted: true;
}
