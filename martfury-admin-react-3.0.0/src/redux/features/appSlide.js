import { createSlice } from '@reduxjs/toolkit';

const initialState = {
    isLoggedIn: false,
    isDrawerMenu: false
};

export const app = createSlice({
    name: 'app',
    initialState,
    reducers: {
        reset: () => initialState,
        toggleDrawerMenu: (state, action) => {
            return {
                ...state,
                isDrawerMenu: action.payload,
            };
        },

        handleLogin: (state) => {
            return {
                ...state,
                isLoggedIn: true,
            };
        },
    },
});

export const { reset, toggleDrawerMenu, handleLogin } = app.actions;

export default app.reducer;
