'use client';
import React, { useEffect, useMemo } from 'react';
import { useParams } from 'next/navigation';
import SkeletonProductDetail from '~/components/elements/skeletons/SkeletonProductDetail';
import BreadCrumb from '~/components/elements/BreadCrumb';
import CustomerBought from '~/components/partials/product/CustomerBought';
import RelatedProduct from '~/components/partials/product/RelatedProduct';
import ProductDetailBox from '~/components/elements/detail/ProductDetailBox';
import PageContainer from '~/components/layouts/PageContainer';
import Newsletters from '~/components/partials/commons/Newletters';
import useGetProducts from '~/hooks/useGetProducts';

const ProductDefaultBoxedPage = () => {
    const params = useParams();
    const { pid } = params;
    const { loading, getStrapiProduct, product } = useGetProducts();

    useEffect(() => {
        getStrapiProduct(pid);
    }, [pid]);

    const breadCrumb = [
        {
            text: 'Home',
            url: '/',
        },
        {
            text: 'Shop',
            url: '/shop',
        },
        {
            text: product?.attributes.title || 'Untitled Product',
        },
    ];

    const productDetails = useMemo(() => {
        if (loading) {
            return <SkeletonProductDetail />;
        }
        if (product) {
            return <ProductDetailBox product={product} />;
        }
    }, [loading, product]);

    return (
        <PageContainer title={product ? product.title : 'Loading...'}>
            <BreadCrumb breacrumb={breadCrumb} />
            <div className="ps-page--product ps-page--product-box">
                <div className="container">
                    {productDetails}
                    <CustomerBought
                        layout="fullwidth"
                        collectionSlug="customer-bought"
                    />
                    <RelatedProduct collectionSlug="shop-recommend-items" />
                </div>
            </div>
            <Newsletters layout="container" />
        </PageContainer>
    );
};

export default ProductDefaultBoxedPage;
