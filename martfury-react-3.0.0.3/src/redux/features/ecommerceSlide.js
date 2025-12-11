import { createSlice } from '@reduxjs/toolkit';

const initialState = {
    wishlistItems: [],
    compareItems: [],
    cartItems: [],
};

export const ecommerce = createSlice({
    name: 'ecommerce',
    initialState,
    reducers: {
        reset: () => initialState,
        showMessage: (state, action) => {
            return {
                state: true,
            };
        },
        changeCartItems: (state, action) => {
            return {
                ...state,
                cartItems: action.payload,
            };
        },
        changeWishlistItems: (state, action) => {
            return {
                ...state,
                wishlistItems: action.payload,
            };
        },
        changeCompareItems: (state, action) => {
            return {
                ...state,
                compareItems: action.payload,
            };
        },
    },
});

export const {
    reset,
    changeCartItems,
    changeWishlistItems,
    changeCompareItems,
} = ecommerce.actions;

export default ecommerce.reducer;
