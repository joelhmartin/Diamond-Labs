import React from 'react';
import { useDispatch, useSelector } from 'react-redux';
import Link from 'next/link';
import { userChangeIsLoggedIn } from '~/redux/features/userSlide';

const accountLinks = [
    {
        text: 'Account Information',
        url: '/account/user-information',
    },
    {
        text: 'Notifications',
        url: '/account/notifications',
    },
    {
        text: 'Invoices',
        url: '/account/invoices',
    },
    {
        text: 'Address',
        url: '/account/addresses',
    },
    {
        text: 'Recent Viewed Product',
        url: '/account/recent-viewed-product',
    },
    {
        text: 'Wishlist',
        url: '/account/wishlist',
    },
];

const AccountQuickLinks = (props) => {
    const dispatch = useDispatch();
    const handleLogout = (e) => {
        e.preventDefault();
        dispatch(userChangeIsLoggedIn(false));
    };

    const isLoggedIn = useSelector(({ user }) => user.isLoggedIn);

    const linksView = accountLinks.map((item) => (
        <li key={item.text}>
            <Link href={item.url}>{item.text}</Link>
        </li>
    ));

    if (isLoggedIn === true) {
        return (
            <div className="ps-block--user-account">
                <i className="icon-user" />
                <div className="ps-block__content">
                    <ul className="ps-list--arrow">
                        {linksView}
                        <li className="ps-block__footer">
                            <a href="#" onClick={(e) => handleLogout(e)}>
                                Logout
                            </a>
                        </li>
                    </ul>
                </div>
            </div>
        );
    } else {
        return (
            <div className="ps-block--user-header">
                <div className="ps-block__left">
                    <i className="icon-user" />
                </div>
                <div className="ps-block__right">
                    <Link href="/account/login">Login</Link>
                    <Link href="/account/register">Register</Link>
                </div>
            </div>
        );
    }
};

export default AccountQuickLinks;
