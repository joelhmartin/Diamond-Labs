import React, { useCallback, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { Tabs } from 'antd';
import Product from '~/components/elements/products/Product';
import HorizontalProduct from '~/components/elements/products/HorizontalProduct';
import useGetProducts from '~/hooks/useGetProducts';
import { DEFAULT_QUERY_GET_PRODUCTS } from '~/services/queries/productStrapiQueries';

const { TabPane } = Tabs;

const Market3ProductGroup = ({ categorySlug, banners, links, heading }) => {
    const { loading, products, getStrapiProducts } = useGetProducts();

    const getProductByCategory = useCallback(
        (categorySlug) => {
            if (categorySlug) {
                const query = {
                    ...DEFAULT_QUERY_GET_PRODUCTS,
                    filters: {
                        product_categories: {
                            slug: {
                                $eq: categorySlug,
                            },
                        },
                    },
                };
                getStrapiProducts(query);
            }
        },
        [getStrapiProducts]
    );

    useEffect(() => {
        getProductByCategory(categorySlug);
    }, []);

    const { tab1, tab2, tab3, recommend, linksList } = useMemo(() => {
        let tab1 = [],
            tab2 = [],
            tab3 = [],
            recommend = [],
            linksList = [];

        if (products && products.length > 0) {
            products.forEach((item, index) => {
                if (index < 4)
                    tab1.push(
                        <div className="col-md-3 col-sm-4 col-6" key={item.id}>
                            <Product product={item} key={item.id} />
                        </div>
                    );
                if (index > 1 && index < 6)
                    tab2.push(
                        <div className="col-md-3 col-sm-4 col-6" key={item.id}>
                            <Product product={item} key={item.id} />
                        </div>
                    );
                if (index > 0 && index < 5)
                    tab3.push(
                        <div className="col-md-3 col-sm-4 col-6" key={item.id}>
                            <Product product={item} key={item.id} />
                        </div>
                    );
                if (index > 3 && index < 8)
                    recommend.push(
                        <HorizontalProduct key={item.id} product={item} />
                    );
            });

            linksList = links.map((item) => (
                <li key={item}>
                    <Link href={'/shop'}>{item}</Link>
                </li>
            ));
        }

        return { tab1, tab2, tab3, recommend, linksList };
    }, [products, links]);
    return (
        <div className="ps-block--product-box">
            <div className="ps-block__header">
                <h3>
                    <i className={heading.icon} /> {heading.title}
                </h3>
                <ul>{linksList}</ul>
            </div>
            <div className="ps-block__content">
                <div className="ps-block__left">
                    {banners}
                    <div className="ps-block__products">
                        <Tabs defaultActiveKey="1">
                            <TabPane tab="New Arrivals" key="1">
                                <div className="row">{tab1}</div>
                            </TabPane>
                            <TabPane tab="Best Seller" key="2">
                                <div className="row">{tab2}</div>
                            </TabPane>
                            <TabPane tab="Sale" key="3">
                                <div className="row">
                                    <div className="row">{tab3}</div>
                                </div>
                            </TabPane>
                        </Tabs>
                    </div>
                </div>
                <div className="ps-block__right">
                    <figure>
                        <figcaption>Recommended For You</figcaption>
                        {recommend}
                    </figure>
                </div>
            </div>
        </div>
    );
};

export default Market3ProductGroup;
