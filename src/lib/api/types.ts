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