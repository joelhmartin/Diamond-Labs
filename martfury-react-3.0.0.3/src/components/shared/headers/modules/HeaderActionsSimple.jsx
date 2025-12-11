import React from 'react';
import { connect } from 'react-redux';
import Link from 'next/link';
import MiniCart from '~/components/shared/headers/modules/MiniCart';
import AccountQuickLinks from '~/components/shared/headers/modules/AccountQuickLinks';

const HeaderActionsSimple = (props) => {
    const { compare, wishlist, auth } = props;
    // views
    let headerAuthView;
    if (auth.isLoggedIn && Boolean(auth.isLoggedIn) === true) {
        headerAuthView = <AccountQuickLinks isLoggedIn={true} />;
    } else {
        headerAuthView = <AccountQuickLinks isLoggedIn={false} />;
    }
    return (
        <div className="header__actions">
            <Link href="/account/compare" className="header__extra">
                <i className="icon-chart-bars" />
                <span>
                    <i>{compare ? compare.compareTotal : 0}</i>
                </span>
            </Link>
            <Link href="/account/wishlist" className="header__extra">
                <i className="icon-heart" />
                <span>
                    <i>{wishlist ? wishlist.wishlistTotal : 0}</i>
                </span>
            </Link>
            <MiniCart />
            {headerAuthView}
        </div>
    );
};

export default connect((state) => state)(HeaderActionsSimple);
