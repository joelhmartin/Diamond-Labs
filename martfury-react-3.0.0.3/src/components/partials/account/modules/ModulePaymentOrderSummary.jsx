import React, { useEffect, useMemo } from 'react';
import Link from 'next/link';
import { useSelector } from 'react-redux';
import { calculateAmount } from '~/utilities/ecomerce-helpers';
import useGetProducts from '~/hooks/useGetProducts';

const ModulePaymentOrderSummary = ({ ecomerce, shipping }) => {
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

    const cartProducts = useMemo(() => {
        if (cartItems.length === 0) return [];
        return products.map((product) => {
            return {
                id: product.id,
                title: product.attributes.title || 'Untitled Product',
                slug: product.attributes.slug || 'untitled-product',
                thumbnailImage: product.attributes.thumbnail || null,
                price: product.attributes.price || 0,
                sale_price: product.attributes.sale_price || 0,
                quantity:
                    cartItems.find((item) => item.id === product.id)
                        ?.quantity ?? 0,
            };
        });
    }, [products, cartItems]);

    const amount = useMemo(() => {
        if (cartProducts && cartProducts.length > 0) {
            return calculateAmount(cartProducts);
        }
        return 0;
    }, [cartProducts]);

    const listItemsView = useMemo(() => {
        if (cartProducts && cartProducts.length > 0) {
            return cartProducts.map((item) => (
                <Link href="/" key={item.id}>
                    <strong>
                        {item.title}
                        <span>x{item.quantity}</span>
                    </strong>
                    <small>${item.quantity * item.price}</small>
                </Link>
            ));
        } else {
            return <p>No Product.</p>;
        }
    }, [cartProducts]);

    const totalView = useMemo(() => {
        const totalAmount = shipping ? parseInt(amount) + 20 : parseInt(amount);
        return (
            <figure className="ps-block__total">
                <h3>
                    Total
                    <strong>${totalAmount}.00</strong>
                </h3>
            </figure>
        );
    }, [amount, shipping]);
    const shippingView = useMemo(() => {
        if (shipping === true) {
            return (
                <figure>
                    <figcaption>
                        <strong>Shipping Fee</strong>
                        <small>$20.00</small>
                    </figcaption>
                </figure>
            );
        }
        return null;
    }, [shipping]);

    return (
        <div className="ps-block--checkout-order">
            <div className="ps-block__content">
                <figure>
                    <figcaption>
                        <strong>Product</strong>
                        <strong>total</strong>
                    </figcaption>
                </figure>
                <figure className="ps-block__items">{listItemsView}</figure>
                <figure>
                    <figcaption>
                        <strong>Subtotal</strong>
                        <small>${amount}</small>
                    </figcaption>
                </figure>
                {shippingView}
                {totalView}
            </div>
        </div>
    );
};
export default ModulePaymentOrderSummary;
