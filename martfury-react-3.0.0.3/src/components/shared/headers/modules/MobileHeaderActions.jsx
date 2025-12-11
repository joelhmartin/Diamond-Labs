import React from 'react';
import { useSelector } from 'react-redux';
import Link from 'next/link';
import AccountQuickLinksMobile from './AccountQuickLinksMobile';

const MobileHeaderActions = ({ auth }) => {
    const cartItems = useSelector(({ ecomerce }) => ecomerce.cartItems);
    const isLoggedIn = useSelector(({ user }) => user.isLoggedIn);

    return (
        <div className="navigation__right">
            <Link href="/account/shopping-cart" className="header__extra">
                <i className="icon-bag2" />
                <span>
                    <i>{cartItems ? cartItems.length : 0}</i>
                </span>
            </Link>

            {isLoggedIn && Boolean(isLoggedIn) === true ? (
                <AccountQuickLinksMobile />
            ) : (
                <div className="header__extra">
                    <Link href="/account/login" legacyBehavior>
                        <i className="icon-user" />
                    </Link>
                </div>
            )}
        </div>
    );
};

export default MobileHeaderActions;
