import React from 'react';
import { useSelector } from 'react-redux';
import Link from 'next/link';

import MiniCart from './MiniCart';
import AccountQuickLinks from './AccountQuickLinks';

const ElectronicHeaderActions = () => {
    const isLoggedIn = useSelector(({ user }) => user.isLoggedIn);
    const ecomerce = useSelector(({ ecomerce }) => ecomerce);
    return (
        <div className="header__actions">
            <Link href="/account/wishlist" className="header__extra">
                <i className="icon-heart" />
                <span>
                    <i>{ecomerce.wishlistItems.length}</i>
                </span>
            </Link>
            <MiniCart />
            {isLoggedIn && Boolean(isLoggedIn) === true ? (
                <AccountQuickLinks isLoggedIn={true} />
            ) : (
                <AccountQuickLinks isLoggedIn={false} />
            )}
        </div>
    );
};

export default ElectronicHeaderActions;
