'use client';
import React, { useMemo } from 'react';
import BreadCrumb from '~/components/elements/BreadCrumb';
import WidgetShopCategories from '~/components/shared/widgets/WidgetShopCategories';
import WidgetShopBrands from '~/components/shared/widgets/WidgetShopBrands';
import WidgetShopFilterByPriceRange from '~/components/shared/widgets/WidgetShopFilterByPriceRange';
import { useParams } from 'next/navigation';
import ProductItems from '~/components/partials/product/ProductItems';
import PageContainer from '~/components/layouts/PageContainer';
import Newletters from '~/components/partials/commons/Newletters';
import FooterDefault from '~/components/shared/footers/FooterDefault';
import useProductBrand from '~/hooks/useProductBrand';

export default function Page() {
    const { slug } = useParams();
    const { loading, brandDetails } = useProductBrand(slug);

    const breadCrumb = [
        {
            text: 'Home',
            url: '/',
        },
        {
            text: 'Shop',
            url: '/',
        },
        {
            text: brandDetails?.title || 'Product brand',
        },
    ];
    const products = useMemo(() => {
        if (!brandDetails) return [];
        return brandDetails.products.data;
    }, [brandDetails]);

    //Views

    const productContent = useMemo(() => {
        if (loading) return <p>Loading...</p>;
        if (brandDetails) {
            return <ProductItems columns={4} products={products} />;
        }
    }, [loading, brandDetails, products]);

    return (
        <PageContainer
            footer={<FooterDefault />}
            title={brandDetails?.title || 'Product brand'}>
            <div className="ps-page--shop">
                <BreadCrumb breacrumb={breadCrumb} />
                <div className="container">
                    <div className="ps-layout--shop ps-shop--category">
                        <div className="ps-layout__left">
                            <WidgetShopCategories />
                            <WidgetShopBrands />
                            <WidgetShopFilterByPriceRange />
                        </div>
                        <div className="ps-layout__right">
                            <h3 className="ps-shop__heading">
                                {brandDetails?.title || 'Product brand'}
                            </h3>
                            {productContent}
                        </div>
                    </div>
                </div>
            </div>
            <Newletters layout="container" />
        </PageContainer>
    );
}
