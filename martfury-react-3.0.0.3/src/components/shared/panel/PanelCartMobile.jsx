import React, { useEffect } from 'react';
import { connect, useSelector } from 'react-redux';
import Link from 'next/link';
import useEcomerce from '~/hooks/useEcomerce';
import useProduct from '~/hooks/useProduct';
import { calculateAmount } from '~/utilities/ecomerce-helpers';
import useGetProducts from '~/hooks/useGetProducts';
import MobileCartProduct from '~/components/elements/products/MobileCartProduct';

const PanelCartMobile = ({ ecomerce }) => {
    const cartItems = useSelector(({ ecomerce }) => ecomerce.cartItems);
    const { getStrapiProducts, products } = useGetProducts();

    function getCartProducts() {
        if (cartItems.length > 0) {
            const query = {
                filters: {
                    id: {
                        $in: cartItems.map((item) => item.id),
                    },
                },
            };
            getStrapiProducts(query);
        }
    }

    useEffect(() => {
        getCartProducts();
    }, [cartItems]);

    function handleRemoveCartItem(e, product) {
        e.preventDefault();
        removeItem(product, ecomerce.cartItems, 'cart');
    }

    /*//view
    let cartItemsView, footerView;

    if (products && products.length > 0) {
        const amount = calculateAmount(products);
        const items = products.map((item) => (
            <MobileCartProduct product={item} />
        ));
        cartItemsView = <div className="ps-cart__items">{items}</div>;
        footerView = (
            <div className="ps-cart__footer">
                <h3>
                    Sub Total:<strong>${amount}</strong>
                </h3>
                <figure>
                    <Link href="/account/shopping-cart" className="ps-btn">
                        View Cart
                    </Link>
                    <Link href="/account/checkout" className="ps-btn">
                        Checkout
                    </Link>
                </figure>
            </div>
        );
    } else {
        cartItemsView = <p>Cart empty!</p>;
        footerView = (
            <div className="ps-cart__footer">
                <Link href={'/shop'} className="ps-btn ps-btn--fullwidth">
                    Shop now
                </Link>
            </div>
        );
    }*/

    const cartItemsView = React.useMemo(() => {
        if (products && products.length > 0) {
            const items = products.map((item) => (
                <MobileCartProduct product={item} />
            ));
            return <div className="ps-cart__items">{items}</div>;
        } else {
            return <p>Cart empty!</p>;
        }
    }, [products]);

    const footerView = React.useMemo(() => {
        if (products && products.length > 0) {
            const amount = calculateAmount(products);
            return (
                <div className="ps-cart__footer">
                    <h3>
                        Sub Total:
                        <strong>
                            ${amount ? amount : Math.floor(Math.random() * 100)}
                        </strong>
                    </h3>
                    <figure>
                        <Link href="/account/shopping-cart" className="ps-btn">
                            View Cart
                        </Link>
                        <Link href="/account/checkout" className="ps-btn">
                            Checkout
                        </Link>
                    </figure>
                </div>
            );
        } else {
            return (
                <div className="ps-cart__footer">
                    <Link href={'/shop'} className="ps-btn ps-btn--fullwidth">
                        Shop now
                    </Link>
                </div>
            );
        }
    }, [products]);
    return (
        <div className="ps-cart--mobile">
            <div className="ps-cart__content">
                {cartItemsView}
                {footerView}
            </div>
        </div>
    );
};
export default connect((state) => state)(PanelCartMobile);
