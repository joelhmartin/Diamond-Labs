import React, { useMemo } from 'react';
import { useSelector } from 'react-redux';
import Link from 'next/link';
import MiniCart from '~/components/shared/headers/modules/MiniCart';
import AccountQuickLinks from '~/components/shared/headers/modules/AccountQuickLinks';

const HeaderActions = () => {
    const compareItems = useSelector(({ ecomerce }) => ecomerce.compareItems);
    const wishlistItems = useSelector(({ ecomerce }) => ecomerce.wishlistItems);
    const isLoggedIn = useSelector(({ user }) => user.isLoggedIn);

    const headerAuthContent = useMemo(() => {
        return <AccountQuickLinks isLoggedIn={true} />;
    }, [isLoggedIn]);

    return (
        <div className="header__actions">
            <Link href="/account/compare" className="header__extra">
                <i className="icon-chart-bars" />
                <span>
                    <i>{compareItems ? compareItems.length : 0}</i>
                </span>
            </Link>
            <Link href="/account/wishlist" className="header__extra">
                <i className="icon-heart" />
                <span>
                    <i>{wishlistItems ? wishlistItems.length : 0}</i>
                </span>
            </Link>
            <MiniCart />
            {headerAuthContent}
        </div>
    );
};

export default HeaderActions;
