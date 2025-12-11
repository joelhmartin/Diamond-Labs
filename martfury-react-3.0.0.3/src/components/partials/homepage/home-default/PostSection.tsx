import classes from './styles/PostSection.module.scss';

// create ArticleItem funtion has thumbnail, title, date, author, category, and description
function ArticleItem() {
    // write function handleSaveImage when click button Save Image
    function handleSaveImage() {
        console.log('Save Image');
        
    }
    return (
        <div className={classes.gridArticle}>
            <button>
                Save Image
            </button>
        </div>
    );
}

export default function PostSection() {
    return (
        <div className={classes.section}>
            <div className={classes.section__top}>
                <div className={classes.section__top__left}>
                    <div className={classes.section__top__left__title}>
                        Latest Posts
                    </div>
                    <div className={classes.section__top__left__subtitle}>
                        Read the latest posts from our blog
                    </div>
                </div>
                <div className={classes.section__top__right}>
                    <button className={classes.section__top__right__button}>
                        View All
                    </button>
                </div>
            </div>
            <div className={classes.section__bottom}>
                <div className={classes.section__postItems}></div>
            </div>
        </div>
    );
}
