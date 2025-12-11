import React, { useEffect } from 'react';
import { useDispatch } from 'react-redux';
import { useCookies } from 'react-cookie';
import {
    changeCartItems,
    changeCompareItems,
    changeWishlistItems,
} from '~/redux/features/ecommerceSlide';

const PageLoader = () => {
    const dispatch = useDispatch();
    const [cookies] = useCookies(['cart', 'compare', 'wishlist']);

    function initEcomerceValues() {
        if (cookies) {
            if (cookies.cart) {
                dispatch(changeCartItems(cookies.cart));
            }
            if (cookies.wishlist) {
                dispatch(changeWishlistItems(cookies.wishlist));
            }
            if (cookies.compare) {
                dispatch(changeCompareItems(cookies.compare));
            }
        }
    }

    useEffect(() => {
        initEcomerceValues();
    }, []);

    // addd loaded class to body when component loaded
    useEffect(() => {
        document.body.classList.add('loaded');
    }, []);

    return (
        <>
            <div id="loader-wrapper">
                <div className="loader-section section-left"></div>
                <div className="loader-section section-right"></div>
            </div>
        </>
    );
};

export default PageLoader;
