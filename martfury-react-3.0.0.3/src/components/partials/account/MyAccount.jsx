import React from 'react';
import Link from 'next/link';

export default function MyAccount() {
    return (
        <section className="ps-my-account ps-page--account">
            <div className="container">
                <div className="row">
                    <div className="col-lg-3 col-md-12">
                        <div className="ps-section__left">
                            <aside className="ps-widget--account-dashboard">
                                <div className="ps-widget__header">
                                    <img src="/static/img/users/3.jpg" />
                                    <figure>
                                        <figcaption>Hello</figcaption>
                                        <p>username@gmail.com</p>
                                    </figure>
                                </div>
                                <div className="ps-widget__content">
                                    <ul>
                                        <li className="active">
                                            <Link href="/account/my-account">
                                                Dashboard
                                            </Link>
                                        </li>
                                        <li>
                                            <Link href="/account/my-account">
                                                Orders
                                            </Link>
                                        </li>
                                        <li>
                                            <Link href="/account/my-account">
                                                Addresses
                                            </Link>
                                        </li>
                                        <li>
                                            <Link href="/account/my-account">
                                                Account Details
                                            </Link>
                                        </li>
                                        <li>
                                            <Link href="/account/my-account">
                                                Logout
                                            </Link>
                                        </li>
                                    </ul>
                                </div>
                            </aside>
                        </div>
                    </div>
                    <div className="col-lg-9">
                        <div className="ps-page__content">
                            <div className="ps-page__dashboard">
                                <p>
                                    Hello <strong>user@gmail.com</strong>!
                                </p>
                                <p>
                                    From your account dashboard you can view
                                    your{' '}
                                    <Link href="/account/orders">
                                        recent orders
                                    </Link>
                                    , manage your{' '}
                                    <Link href="/account/user-information">
                                        shipping and billing addresses
                                    </Link>
                                    , and{' '}
                                    <Link href="/account/user-information">
                                        edit your password and account details
                                    </Link>
                                    .
                                </p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </section>
    );
}
