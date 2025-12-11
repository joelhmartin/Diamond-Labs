import React, { useEffect, useMemo } from 'react';
import { useSelector } from 'react-redux';
import Link from 'next/link';
import OnCartProduct from '~/components/elements/products/OnCartProduct';
import useEcomerce from '~/hooks/useEcomerce';
import { calculateAmount } from '~/utilities/ecomerce-helpers';
import useGetProducts from '~/hooks/useGetProducts';

const MiniCart = () => {
    const { removeItem } = useEcomerce();
    const cartItems = useSelector(({ ecomerce }) => ecomerce.cartItems);
    const { getStrapiProducts, products } = useGetProducts();

    function handleRemoveItem(e, productId) {
        e.preventDefault();
        removeItem({ id: productId }, cartItems, 'cart');
    }

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

    const cartAmount = useMemo(() => {
        return calculateAmount(cartProducts);
    }, [cartProducts]);

    const cartItemsContent = useMemo(() => {
        if (cartProducts.length === 0) {
            return (
                <div className="ps-cart__content">
                    <div className="ps-cart__items">
                        <span>No products in cart</span>
                    </div>
                </div>
            );
        }

        return (
            <div className="ps-cart__content">
                <div className="ps-cart__items">
                    {cartProducts.map((item) => {
                        return (
                            <OnCartProduct product={item} key={item.id}>
                                <a
                                    className="ps-product__remove"
                                    onClick={(e) =>
                                        handleRemoveItem(e, item.id)
                                    }>
                                    <i className="icon-cross" />
                                </a>
                            </OnCartProduct>
                        );
                    })}
                </div>
                <div className="ps-cart__footer">
                    <h3>
                        Sub Total:
                        <strong>${cartAmount}</strong>
                    </h3>
                    <figure>
                        <Link
                            href={'/account/shopping-cart'}
                            className="ps-btn">
                            View Cart
                        </Link>
                        <Link href={'/account/checkout'} className="ps-btn">
                            Checkout
                        </Link>
                    </figure>
                </div>
            </div>
        );
    }, [cartProducts]);

    return (
        <div className="ps-cart--mini">
            <a className="header__extra" href="#">
                <i className="icon-bag2" />
                <span>
                    <i>{cartProducts.length}</i>
                </span>
            </a>
            {cartItemsContent}
        </div>
    );
};

export default MiniCart;
