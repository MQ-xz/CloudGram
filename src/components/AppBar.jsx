import { AppBar, Toolbar, Typography, Container } from "@mui/material";

function ResponsiveAppBar() {
    return (
        <AppBar position="static">
            <Container maxWidth="xl">
                <Toolbar disableGutters>
                    <img src="/CloudGram.svg" width={40} style={{ marginRight: "10px" }} />
                    <Typography
                        variant="h6"
                        noWrap
                        component="a"
                        // href="/"
                        sx={{
                            mr: 2,
                            fontFamily: "monospace",
                            fontWeight: 700,
                            letterSpacing: ".3rem",
                            color: "inherit",
                            textDecoration: "none",
                        }}
                    >
                        CloudGram
                    </Typography>
                </Toolbar>
            </Container>
        </AppBar>
    );
}
export default ResponsiveAppBar;
