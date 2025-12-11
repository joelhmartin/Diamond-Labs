import { configureStore, getDefaultMiddleware } from '@reduxjs/toolkit';

import app from './features/appSlide';
import { setupListeners } from '@reduxjs/toolkit/dist/query';

export const store = configureStore({
    reducer: {
        app
    },
    //devTools: process.env.NODE_ENV !== 'production',
    devTools: true,
 /*   middleware: getDefaultMiddleware({
        serializableCheck: false,
    }),*/
});

setupListeners(store.dispatch);
