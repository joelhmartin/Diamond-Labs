import React, { useEffect, useMemo } from 'react';
import { useSelector } from 'react-redux';
import Link from 'next/link';
import { Rate } from 'antd';
import useEcomerce from '~/hooks/useEcomerce';
import useGetProducts from '~/hooks/useGetProducts';

export default function Compare() {
    const ecomerce = useSelector(({ ecomerce }) => ecomerce);
    const { addItem, removeItem } = useEcomerce();
    const compareItems = useSelector(({ ecomerce }) => ecomerce.compareItems);
    const { getStrapiProducts, products } = useGetProducts();

    function getProducts() {
        if (compareItems.length > 0) {
            const query = {
                filters: {
                    id: {
                        $in: compareItems.map((item) => item.id),
                    },
                },
            };
            getStrapiProducts(query);
        }
    }

    useEffect(() => {
        getProducts();
    }, [compareItems]);

    function handleAddItemToCart(e, product) {
        e.preventDefault();
        addItem({ id: product.id, quantity: 1 }, ecomerce.cartItems, 'cart');
    }

    function handleRemoveCompareItem(e, product) {
        e.preventDefault();
        removeItem(product, ecomerce.compareItems, 'compare');
    }

    useEffect(() => {
        if (ecomerce) {
            getProducts(ecomerce.compareItems);
        }
    }, [ecomerce.compareItems]);

    const content = useMemo(() => {
        if (products.length === 0) {
            return (
                <div className="alert alert-danger" role="alert">
                    Compare list is empty!
                </div>
            );
        }
        return (
            <div className="table-responsive">
                <table className="table ps-table--compare">
                    <tbody>
                        <tr>
                            <td className="heading" rowSpan="2">
                                Product
                            </td>
                            {products && products.length > 0 ? (
                                products.map((product) => (
                                    <td key={product.id}>
                                        <a
                                            href="#"
                                            onClick={(e) =>
                                                handleRemoveCompareItem(
                                                    e,
                                                    product
                                                )
                                            }>
                                            Remove
                                        </a>
                                    </td>
                                ))
                            ) : (
                                <td></td>
                            )}
                        </tr>
                        <tr>
                            {products && products.length > 0 ? (
                                products.map((product) => (
                                    <td key={product.id}>
                                        <div className="ps-product--compare">
                                            <div className="ps-product__thumbnail">
                                                <Link
                                                    href={'/product/[pid]'}
                                                    as={`/product/${product.id}`}>
                                                    {thumbnailImage}
                                                </Link>
                                            </div>
                                            <div className="ps-product__content">
                                                <Link
                                                    href={'/product/[pid]'}
                                                    as={`/product/${product.id}`}
                                                    className="ps-product__title">
                                                    {product.title}
                                                </Link>
                                            </div>
                                        </div>
                                    </td>
                                ))
                            ) : (
                                <td></td>
                            )}
                        </tr>
                        <tr>
                            <td className="heading">Rating</td>
                            {products && products.length > 0 ? (
                                products.map((product) => (
                                    <td key={product.id}>
                                        <Rate disabled defaultValue={4} />
                                    </td>
                                ))
                            ) : (
                                <td></td>
                            )}
                        </tr>
                        <tr>
                            <td className="heading">Price</td>
                            {products && products.length > 0 ? (
                                products.map((product) => {
                                    if (product.sale === true) {
                                        return (
                                            <td key={product.id}>
                                                <h4 className="price sale">
                                                    ${product.price}
                                                    <del>
                                                        ${product.salePrice}
                                                    </del>
                                                </h4>
                                            </td>
                                        );
                                    } else
                                        return (
                                            <td key={product.id}>
                                                <h4 className="price">
                                                    $ {product.price}
                                                </h4>
                                            </td>
                                        );
                                })
                            ) : (
                                <td></td>
                            )}
                        </tr>
                        <tr>
                            <td className="heading">Sold By</td>
                            {products && products.length > 0 ? (
                                products.map((product) => (
                                    <td key={product.id}>
                                        <Link href="/vendor/store-list">
                                            {product.vendor}
                                        </Link>
                                    </td>
                                ))
                            ) : (
                                <td></td>
                            )}
                        </tr>
                        <tr>
                            <td className="heading"></td>
                            {products && products.length > 0 ? (
                                products.map((product) => (
                                    <td key={product.id}>
                                        <button
                                            className="ps-btn"
                                            onClick={(e) =>
                                                handleAddItemToCart(e, product)
                                            }>
                                            Add To Cart
                                        </button>
                                    </td>
                                ))
                            ) : (
                                <td></td>
                            )}
                        </tr>
                    </tbody>
                </table>
            </div>
        );
    }, [products]);

    return (
        <div className="ps-compare ps-section--shopping">
            <div className="container">
                <div className="ps-section__header">
                    <h1>Compare Product</h1>
                </div>
                <div className="ps-section__content">{content}</div>
            </div>
        </div>
    );
}
