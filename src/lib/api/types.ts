export interface ApiSuccess<T> {
  success: true;
  data: T;
  message: string;
}

export interface ApiFailure {
  success: false;
  data: null;
  message: string;
  code?: string;
}

export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

export interface AuthUser {
  id: string;
  role: string;
  /**
   * Account state as reported by `/auth/me` (#251). Present only on a user
   * resolved through `/auth/me`; login/register/refresh responses do not carry
   * it. Absent means "no restriction known", never "not restricted".
   */
  accountState?: string;
}

export interface BackendAuthUser extends AuthUser {
  name: string;
  email: string;
}
