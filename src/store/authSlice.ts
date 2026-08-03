import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

export type AuthStage = 'PASSWORD_CHANGE' | 'TOTP_SETUP' | 'TOTP_REQUIRED' | null;

interface AuthState {
  accessToken: string | null;
  user: {
    id: number; username: string; fullName: string;
    role: 'ADMIN' | 'VIEWER';
    permissions: Record<string, 'none' | 'view' | 'edit'>;
  } | null;
  preAuthToken: string | null;
  stage: AuthStage;
}

const initialState: AuthState = {
  accessToken: null,
  user: null,
  preAuthToken: null,
  stage: null,
};

const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    setTokens(state, action: PayloadAction<{ accessToken: string }>) {
      state.accessToken = action.payload.accessToken;
    },
    setUser(state, action: PayloadAction<AuthState['user']>) {
      state.user = action.payload;
    },
    setPreAuth(state, action: PayloadAction<{ preAuthToken: string; stage: AuthStage }>) {
      state.preAuthToken = action.payload.preAuthToken;
      state.stage = action.payload.stage;
    },
    clearPreAuth(state) {
      state.preAuthToken = null;
      state.stage = null;
    },
    logout(state) {
      state.accessToken = null;
      state.user = null;
      state.preAuthToken = null;
      state.stage = null;
    },
  },
});

export const { setTokens, setUser, setPreAuth, clearPreAuth, logout } = authSlice.actions;
export default authSlice.reducer;
