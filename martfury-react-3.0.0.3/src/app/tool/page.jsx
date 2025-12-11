'use client';
import React, { useEffect, useMemo } from 'react';
import PageContainer from '~/components/layouts/PageContainer';
import { Table } from 'antd';
import useGetProducts from '~/hooks/useGetProducts';
import { updateEntry } from '~/services/strapiServices/strapiHttpServices';

export default function Page() {
    const { loading, products, getStrapiProducts } = useGetProducts();
    useEffect(() => {
        getStrapiProducts({
            populate: '*',
            pagination: {
                pageSize: 99999999,
            },
        });
    }, []);

    const productSource = useMemo(() => {
        if (products.length === 0) return [];
        return products.map(
            (product) => {
                const { id, attributes } = product;
                return {
                    key: id,
                    title: attributes.title,
                    price: attributes.price,
                    type: attributes.type || '-',
                };
            },
            [products]
        );
    }, [products]);

    const updateProductPrice = async () => {
        if (products.length > 0) {
            await Promise.all(
                products.map(
                    async (item) => {
                        const params = {
                            data: {
                                price: parseFloat(
                                    (
                                        Math.floor(Math.random() * 89.99) +
                                        10.99
                                    ).toFixed(2)
                                ),
                            },
                        };
                        await updateEntry(`products/${item.id}`, params);
                        return params;
                    },
                    getStrapiProducts({
                        populate: '*',
                        pagination: {
                            pageSize: 99999999,
                        },
                    })
                )
            );
        }
    };
    const updateProductType = async () => {
        if (products.length > 0) {
            await Promise.all(
                products.map(
                    async (item) => {
                        const types = [
                            'new-arrivals',
                            'best-seller',
                            'most-popular',
                        ];
                        const params = {
                            data: {
                                type: types[
                                    Math.floor(Math.random() * types.length)
                                ],
                            },
                        };
                        await updateEntry(`products/${item.id}`, params);
                        return params;
                    },
                    getStrapiProducts({
                        populate: '*',
                        pagination: {
                            pageSize: 99999999,
                        },
                    })
                )
            );
        }
    };

    const columns = [
        {
            title: 'title',
            dataIndex: 'title',
            key: 'title',
        },
        {
            title: 'Price',
            dataIndex: 'price',
            key: 'price',
        },
        {
            title: 'type',
            dataIndex: 'type',
            key: 'type',
        },
    ];
    return (
        <PageContainer>
            <div className="container mt-20">
                <div className="mb-20">
                    <button
                        className="ps-btn ps-btn--ghost mr-2"
                        onClick={updateProductPrice}>
                        Update Price
                    </button>
                    <button
                        className="ps-btn ps-btn--ghost"
                        onClick={updateProductType}>
                        Update Type
                    </button>
                </div>
                <Table dataSource={productSource} columns={columns} />;
            </div>
        </PageContainer>
    );
}
