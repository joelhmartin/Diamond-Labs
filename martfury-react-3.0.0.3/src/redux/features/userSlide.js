import { createSlice } from '@reduxjs/toolkit';

const initialState = {
    isLoggedIn: false,
};

export const ecommerce = createSlice({
    name: 'message',
    initialState,
    reducers: {
        reset: () => initialState,
        userChangeIsLoggedIn: (state, action) => {
            return {
                ...state,
                isLoggedIn: action.payload,
            };
        },
    },
});

export const { reset, userChangeIsLoggedIn } = ecommerce.actions;

export default ecommerce.reducer;
