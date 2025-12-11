'use client';
import React, { useEffect, useMemo } from 'react';
import { useParams } from 'next/navigation';
import SkeletonProductDetail from '~/components/elements/skeletons/SkeletonProductDetail';
import BreadCrumb from '~/components/elements/BreadCrumb';
import ProductWidgets from '~/components/partials/product/ProductWidgets';
import CustomerBought from '~/components/partials/product/CustomerBought';
import RelatedProduct from '~/components/partials/product/RelatedProduct';
import ProductDetailSidebar from '~/components/elements/detail/ProductDetailSidebar';
import PageContainer from '~/components/layouts/PageContainer';
import FooterDefault from '~/components/shared/footers/FooterDefault';
import Newletters from '~/components/partials/commons/Newletters';
import useGetProducts from '~/hooks/useGetProducts';

const ProductDefaultPage = () => {
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
            return <ProductDetailSidebar product={product} />;
        }
    }, [loading, product]);

    return (
        <PageContainer
            footer={<FooterDefault />}
            title={product ? product.title : 'Loading...'}
            boxed={true}>
            <BreadCrumb breacrumb={breadCrumb} layout="fullwidth" />
            <div className="ps-page--product reverse">
                <div className="container">
                    <div className="ps-page__container">
                        <div className="ps-page__left">{productDetails}</div>
                        <div className="ps-page__right">
                            <ProductWidgets />
                        </div>
                    </div>

                    <CustomerBought
                        layout="standard"
                        collectionSlug="customer-bought"
                    />
                    <RelatedProduct collectionSlug="shop-recommend-items" />
                </div>
            </div>
            <Newletters layout="container" />
        </PageContainer>
    );
};

export default ProductDefaultPage;
