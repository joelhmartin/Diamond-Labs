import { configureStore } from '@reduxjs/toolkit';
import ecomerce from './features/ecommerceSlide';
import user from './features/userSlide';

export const store = configureStore({
    reducer: {
        user,
        ecomerce,
    },
    devTools: true,
});


