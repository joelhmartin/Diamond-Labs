import React, { useMemo } from 'react';
import { useSelector } from 'react-redux';
import useEcomerce from '~/hooks/useEcomerce';
import { Result } from 'antd';
import CartProduct from '~/components/elements/products/CartProduct';

const ModuleEcomerceCartItems = ({ products }) => {
    const ecomerce = useSelector(({ ecomerce }) => ecomerce);
    const cartItems = useSelector(({ ecomerce }) => ecomerce.cartItems);
    const { increaseQty, decreaseQty, removeItem } = useEcomerce();

    function handleRemoveItem(e, productId) {
        e.preventDefault();
        removeItem({ id: productId }, cartItems, 'cart');
    }

    function handleIncreaseItemQty(e, productId) {
        e.preventDefault();
        increaseQty({ id: productId }, ecomerce.cartItems);
    }

    function handleDecreaseItemQty(e, productId) {
        e.preventDefault();
        decreaseQty({ id: productId }, ecomerce.cartItems);
    }

    const cartItemsContent = useMemo(() => {
        if (products.length === 0) {
            return <Result status="warning" title="No product in cart." />;
        }
        return (
            <table className="table  ps-table--shopping-cart ps-table--responsive">
                <thead>
                    <tr>
                        <th>Product</th>
                        <th>Price</th>
                        <th>Quantity</th>
                        <th>Total</th>
                        <th>Action</th>
                    </tr>
                </thead>
                <tbody>
                    {products.map((item) => (
                        <tr key={item.id}>
                            <td>
                                {' '}
                                <CartProduct product={item} />
                            </td>
                            <td data-label="price" className="price">
                                ${item.price}
                            </td>
                            <td data-label="quantity">
                                <div className="form-group--number">
                                    <button
                                        className="up"
                                        onClick={(e) =>
                                            handleIncreaseItemQty(e, item.id)
                                        }>
                                        +
                                    </button>
                                    <button
                                        className="down"
                                        onClick={(e) =>
                                            handleDecreaseItemQty(e, item.id)
                                        }>
                                        -
                                    </button>
                                    <input
                                        className="form-control"
                                        type="text"
                                        placeholder={
                                            cartItems.find(
                                                (i) => i.id === item.id
                                            )?.quantity
                                        }
                                        disabled={true}
                                    />
                                </div>
                            </td>
                            <td data-label="total">
                                <strong>
                                    ${(item.price * item.quantity).toFixed(2)}
                                </strong>
                            </td>
                            <td>
                                <a
                                    href="#"
                                    onClick={(e) =>
                                        handleRemoveItem(e, item.id)
                                    }>
                                    <i className="icon-cross" />
                                </a>
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        );
    }, [cartItems, products]);

    // View
    return <>{cartItemsContent}</>;
};

export default ModuleEcomerceCartItems;
