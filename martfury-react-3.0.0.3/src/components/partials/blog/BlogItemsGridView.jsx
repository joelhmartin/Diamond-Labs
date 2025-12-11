import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import PostGrid from '~/components/elements/post/PostGrid';
import CustomPagination from '~/components/elements/common/CustomPagination';
import useBlog from '~/hooks/useBlog';

const categories = [
    {
        text: 'All',
        url: '/blog',
    },
    {
        text: 'Life Style',
        url: '/blog/life-style',
    },
    {
        text: 'Technology',
        url: '/blog/technology',
    },
    {
        text: 'Entertaiment',
        url: '/blog/entertainment',
    },
    {
        text: 'Business',
        url: '/blog/business',
    },
    {
        text: 'Others',
        url: '/blog/others',
    },
    {
        text: 'Fashion',
        url: '/blog/fashion',
    },
];

const BlogItemsGridView = ({ collectionSlug, columns }) => {
    const { loading, getPosts, posts } = useBlog();
    const [category, setCategory] = useState(categories[0]);

    useEffect(() => {
        getPosts();
    }, []);

    const blogContent = useMemo(() => {
        if (loading) return <p>Loading...</p>;
        if (posts.length === 0) return <p>No posts found</p>;
        return posts.map((item) => {
            if (columns === 4) {
                return (
                    <div className=" col-md-4 col-sm-6" key={item.id}>
                        <PostGrid post={item} />
                    </div>
                );
            } else if (columns === 4) {
                return (
                    <div className="col-lg-3 col-md-4 col-sm-6" key={item.id}>
                        <PostGrid post={item} />
                    </div>
                );
            } else {
                return (
                    <div className="col-md-6" key={item.id}>
                        <PostGrid post={item} />
                    </div>
                );
            }
        });
    }, [loading, posts]);

    return (
        <div className="ps-blog">
            <div className="ps-blog__header">
                <ul className="ps-list--blog-links">
                    {categories.map((item) => (
                        <li
                            key={item.url}
                            className={
                                category.text === item.text ? 'active' : ''
                            }>
                            <Link href={item.url}>{item.text}</Link>
                        </li>
                    ))}
                </ul>
            </div>
            <div className="ps-blog__content">
                <div className="row">{blogContent}</div>
                <CustomPagination />
            </div>
        </div>
    );
};

export default BlogItemsGridView;
