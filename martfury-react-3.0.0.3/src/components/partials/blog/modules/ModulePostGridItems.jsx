import React, { useEffect, useMemo } from 'react';
import PostGrid from '~/components/elements/post/PostGrid';
import CustomPagination from '~/components/elements/common/CustomPagination';
import useBlog from '~/hooks/useBlog';

const ModulePostGridItems = ({ columns }) => {
    const { loading, getPosts, posts } = useBlog();

    useEffect(() => {
        getPosts();
    }, []);

    const content = useMemo(() => {
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
        <div className="ps-post-items">
            <div className="row">{content}</div>
            <CustomPagination />
        </div>
    );
};

export default ModulePostGridItems;
