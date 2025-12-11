import React, {
    Suspense,
    useCallback,
    useEffect,
    useMemo,
    useState,
} from 'react';
import { Pagination } from 'antd';
import Product from '~/components/elements/products/Product';
import WideProduct from '~/components/elements/products/WideProduct';
import ModuleShopSortBy from '~/components/partials/shop/modules/ModuleShopSortBy';
import { generateTempArray } from '~/utilities/common-helpers';
import SkeletonProduct from '~/components/elements/skeletons/SkeletonProduct';
import useGetProducts from '~/hooks/useGetProducts';
import { useRouter, useSearchParams } from 'next/navigation';
import { DEFAULT_QUERY_GET_PRODUCTS } from '~/services/queries/productStrapiQueries';

const ShopItems = ({ columns = 4, pageSize = 12 }) => {
    const Router = useRouter();
    const searchParams = useSearchParams();
    const pageIndex = searchParams.get('page');
    const { query } = Router;
    const [listView, setListView] = useState(true);
    const [classes, setClasses] = useState(
        'col-xl-4 col-lg-4 col-md-3 col-sm-6 col-6'
    );

    const { loading, products, meta, getStrapiProducts } = useGetProducts();

    const total = useMemo(() => (meta ? meta.pagination.total : 0), [meta]);

    function handleChangeViewMode(e) {
        e.preventDefault();
        setListView(!listView);
    }

    function handlePagination(page, pageSize) {
        Router.push(`/shop?page=${page}`);
    }

    function handleSetColumns() {
        switch (columns) {
            case 2:
                setClasses('col-xl-6 col-lg-6 col-md-6 col-sm-6 col-6');
                return 3;
                break;
            case 4:
                setClasses('col-xl-3 col-lg-4 col-md-6 col-sm-6 col-6');
                return 4;
                break;
            case 6:
                setClasses('col-xl-2 col-lg-4 col-md-6 col-sm-6 col-6');
                return 6;
                break;

            default:
                setClasses('col-xl-4 col-lg-4 col-md-3 col-sm-6 col-6');
        }
    }

    const getProducts = useCallback(
        (payload) => {
            const query = payload
                ? {
                      ...DEFAULT_QUERY_GET_PRODUCTS,
                      ...payload,
                  }
                : {
                      ...DEFAULT_QUERY_GET_PRODUCTS,
                  };
            getStrapiProducts(query);
        },
        [getStrapiProducts]
    );

    useEffect(() => {
        getProducts();
        handleSetColumns();
    }, []);

    useEffect(() => {
        let params;
        const page = pageIndex || 1;
        if (query) {
            if (page !== 1) {
                params = {
                    pagination: {
                        page: page,
                        pageSize: pageSize,
                    },
                };
            }
        } else {
            params = {
                pagination: {
                    page: 1,
                    pageSize: pageSize,
                },
            };
        }
        getProducts(params);
        handleSetColumns();
    }, [query]);

    const productsContent = useMemo(() => {
        if (!loading) {
            if (products && products.length > 0) {
                if (listView) {
                    const items = products.map((item) => (
                        <div className={classes} key={item.id}>
                            <Product product={item} />
                        </div>
                    ));
                    return (
                        <div className="ps-shop-items">
                            <div className="row">{items}</div>
                        </div>
                    );
                } else {
                    return products.map((item) => (
                        <WideProduct product={item} />
                    ));
                }
            } else {
                return <p>No product found.</p>;
            }
        } else {
            const skeletonItems = generateTempArray(12).map((item) => (
                <div className={classes} key={item}>
                    <SkeletonProduct />
                </div>
            ));
            return <div className="row">{skeletonItems}</div>;
        }
    }, [loading, listView, products, classes]);

    return (
        <Suspense>
            <div className="ps-shopping">
                <div className="ps-shopping__header">
                    <p>
                        <strong className="mr-2">{total}</strong>
                        Products found
                    </p>
                    <div className="ps-shopping__actions">
                        <ModuleShopSortBy />
                        <div className="ps-shopping__view">
                            <p>View</p>
                            <ul className="ps-tab-list">
                                <li
                                    className={
                                        listView === true ? 'active' : ''
                                    }>
                                    <a
                                        href="#"
                                        onClick={(e) =>
                                            handleChangeViewMode(e)
                                        }>
                                        <i className="icon-grid" />
                                    </a>
                                </li>
                                <li
                                    className={
                                        listView !== true ? 'active' : ''
                                    }>
                                    <a
                                        href="#"
                                        onClick={(e) =>
                                            handleChangeViewMode(e)
                                        }>
                                        <i className="icon-list4" />
                                    </a>
                                </li>
                            </ul>
                        </div>
                    </div>
                </div>
                <div className="ps-shopping__content">{productsContent}</div>
                <div className="ps-shopping__footer text-center">
                    <div className="ps-pagination">
                        <Pagination
                            total={total - 1}
                            pageSize={pageSize}
                            responsive={true}
                            showSizeChanger={false}
                            current={
                                pageIndex !== undefined
                                    ? parseInt(pageIndex)
                                    : 1
                            }
                            onChange={(e) => handlePagination(e)}
                        />
                    </div>
                </div>
            </div>
        </Suspense>
    );
};

export default ShopItems;
