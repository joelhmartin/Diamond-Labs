import React from 'react';
import { useSelector } from 'react-redux';
import { Modal } from 'antd';
import useProduct from '~/hooks/useProduct';
import useEcomerce from '~/hooks/useEcomerce';

const WideProductActions = ({ product }) => {
    const ecomerce = useSelector(({ ecomerce }) => ecomerce);
    const { price } = useProduct(product.attributes, product.id);
    const { addItem } = useEcomerce();

    function handleAddItemToCart(e) {
        e.preventDefault();
        addItem({ id: product.id, quantity: 1 }, ecomerce.cartItems, 'cart');
    }

    function handleAddItemToWishlist(e) {
        e.preventDefault();
        addItem({ id: product.id }, ecomerce.wishlistItems, 'wishlist');
        const modal = Modal.success({
            centered: true,
            title: 'Success!',
            content: `This item has been added to your wishlist`,
        });
        modal.update;
    }

    function handleAddItemToCompare(e) {
        e.preventDefault();
        addItem({ id: product.id }, ecomerce.compareItems, 'compare');
        const modal = Modal.success({
            centered: true,
            title: 'Success!',
            content: `This product has been added to your compare listing!`,
        });
        modal.update;
    }

    return (
        <div className="ps-product__shopping">
            {price}
            <a
                className="ps-btn"
                href="#"
                onClick={(e) => handleAddItemToCart(e)}>
                Add to cart
            </a>
            <ul className="ps-product__actions">
                <li>
                    <a href="#" onClick={(e) => handleAddItemToWishlist(e)}>
                        <i className="icon-heart" /> Wishlist
                    </a>
                </li>
                <li>
                    <a href="#" onClick={(e) => handleAddItemToCompare(e)}>
                        <i className="icon-chart-bars" /> Compare
                    </a>
                </li>
            </ul>
        </div>
    );
};

export default WideProductActions;
